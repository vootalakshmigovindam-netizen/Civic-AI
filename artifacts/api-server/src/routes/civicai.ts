import {
  AnalyzeImageBody,
  AnalyzeImageResponse,
  CreateComplaintBody,
  CreateComplaintResponse,
  GetComplaintHistoryParams,
  GetComplaintHistoryResponse,
  GetComplaintParams,
  GetComplaintResponse,
  GetDashboardSummaryResponse,
  ListComplaintsQueryParams,
  ListComplaintsResponse,
  ListMapComplaintsQueryParams,
  ListMapComplaintsResponse,
  ListMyComplaintsResponse,
  UpdateComplaintStatusBody,
  UpdateComplaintStatusParams,
  UpdateComplaintStatusResponse,
} from "@workspace/api-zod";
import {
  complaintHistoryTable,
  complaintsTable,
  db,
  usersTable,
} from "@workspace/db";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { Router, type IRouter } from "express";

const router: IRouter = Router();
const priorityBySeverity: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};
const issueTypes = [
  "pothole",
  "garbage",
  "streetlight",
  "sidewalk",
  "water_leak",
  "damaged_road",
  "drainage",
  "graffiti",
  "traffic_signal",
  "public_space",
  "fallen_tree",
  "other",
];
const severities = ["low", "medium", "high", "critical"];
const statuses = [
  "submitted",
  "under_review",
  "assigned",
  "in_progress",
  "resolved",
  "rejected",
];
const imageDataUrlPattern = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/;

function fullName(firstName: string | null, lastName: string | null): string {
  return [firstName, lastName].filter(Boolean).join(" ") || "Community member";
}

function toComplaint(
  complaint: typeof complaintsTable.$inferSelect,
  reporterName = "Community member",
  includeImage = false,
) {
  return {
    ...complaint,
    latitude: Math.round(complaint.latitude * 1000) / 1000,
    longitude: Math.round(complaint.longitude * 1000) / 1000,
    imageUrl: includeImage ? complaint.imageUrl : null,
    reporterName,
    priorityScore:
      complaint.priorityScore || priorityBySeverity[complaint.severity] || 1,
  };
}

function statusFilter(value: string | undefined) {
  return value && statuses.includes(value) ? value : undefined;
}

function imageDemoResult(imageData: string) {
  const choices = [
    {
      issueType: "pothole",
      severity: "medium",
      description:
        "A possible road-surface hazard is visible. Please confirm the issue type and severity before submitting.",
    },
    {
      issueType: "garbage",
      severity: "medium",
      description:
        "A possible public-space cleanliness issue is visible. Please confirm the issue type and severity before submitting.",
    },
    {
      issueType: "streetlight",
      severity: "low",
      description:
        "A possible damaged streetlight is visible. Please confirm the issue type and severity before submitting.",
    },
    {
      issueType: "water_leak",
      severity: "high",
      description:
        "A possible water leak is visible. Please confirm the issue type and severity before submitting.",
    },
  ] as const;
  const selected = choices[imageData.length % choices.length];
  return {
    ...selected,
    confidence: 0.58,
    demoMode: true,
  };
}

async function analyzeWithOpenAI(imageData: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5.4-mini",
      max_completion_tokens: 1000,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Classify the visible civic infrastructure issue. Only return JSON with issueType, severity, confidence, description. issueType must be one of: pothole, garbage, streetlight, sidewalk, water_leak, damaged_road, drainage, graffiti, traffic_signal, public_space, fallen_tree, other. severity must be low, medium, high, or critical. confidence must be between 0 and 1. Be conservative and describe only what is visible.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Analyze this image for a civic issue." },
            { type: "image_url", image_url: { url: imageData } },
          ],
        },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI image analysis returned ${response.status}`);
  }
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned an empty image analysis");
  const parsed = JSON.parse(content) as Record<string, unknown>;
  const issueType =
    typeof parsed.issueType === "string" &&
    issueTypes.includes(parsed.issueType.toLowerCase())
      ? parsed.issueType.toLowerCase()
      : "other";
  const severity =
    typeof parsed.severity === "string" &&
    severities.includes(parsed.severity.toLowerCase())
      ? parsed.severity.toLowerCase()
      : "medium";
  const confidence =
    typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0.5;
  const description =
    typeof parsed.description === "string"
      ? parsed.description.slice(0, 600)
      : "Possible civic infrastructure issue. Please review and edit this description.";
  return { issueType, severity, confidence, description, demoMode: false };
}

router.post("/ai/analyze", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in to analyze an issue photo." });
    return;
  }
  const parsed = AnalyzeImageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const match = imageDataUrlPattern.exec(parsed.data.imageData);
  if (!match) {
    res.status(400).json({ error: "Use a JPEG, PNG, or WEBP image." });
    return;
  }
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length === 0 || bytes.length > 8 * 1024 * 1024) {
    res.status(400).json({ error: "Images must be smaller than 8 MB." });
    return;
  }
  try {
    const result =
      (await analyzeWithOpenAI(parsed.data.imageData)) ??
      imageDemoResult(parsed.data.imageData);
    res.json(AnalyzeImageResponse.parse(result));
  } catch (error) {
    req.log.warn({ err: error }, "AI image analysis unavailable; using demo mode");
    res.json(AnalyzeImageResponse.parse(imageDemoResult(parsed.data.imageData)));
  }
});

router.get("/complaints", async (req, res): Promise<void> => {
  const parsed = ListComplaintsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { issueType, severity, status, search } = parsed.data;
  const conditions = [];
  if (issueType) conditions.push(eq(complaintsTable.issueType, issueType));
  if (severity && severities.includes(severity)) {
    conditions.push(eq(complaintsTable.severity, severity));
  }
  const safeStatus = statusFilter(status);
  if (safeStatus) conditions.push(eq(complaintsTable.status, safeStatus));
  if (search?.trim()) {
    const term = `%${search.trim().slice(0, 100)}%`;
    conditions.push(
      or(
        ilike(complaintsTable.complaintNumber, term),
        ilike(complaintsTable.address, term),
        ilike(complaintsTable.description, term),
      )!,
    );
  }
  const rows = await db
    .select()
    .from(complaintsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(complaintsTable.priorityScore), desc(complaintsTable.createdAt))
    .limit(200);
  res.json(ListComplaintsResponse.parse(rows.map((row) => toComplaint(row))));
});

router.get("/complaints/my", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in to view your reports." });
    return;
  }
  const rows = await db
    .select()
    .from(complaintsTable)
    .where(eq(complaintsTable.userId, req.user.id))
    .orderBy(desc(complaintsTable.createdAt))
    .limit(100);
  res.json(
    ListMyComplaintsResponse.parse(
      rows.map((row) =>
        toComplaint(
          row,
          fullName(req.user.firstName, req.user.lastName),
          true,
        ),
      ),
    ),
  );
});

router.post("/complaints", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in to submit a report." });
    return;
  }
  const parsed = CreateComplaintBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;
  if (
    input.imageUrl &&
    !input.imageUrl.startsWith("/api/storage/objects/uploads/")
  ) {
    res.status(400).json({ error: "The complaint photo is not a valid upload." });
    return;
  }
  const complaintNumber = `CIV-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
  const complaint = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(complaintsTable)
      .values({
        complaintNumber,
        userId: req.user.id,
        issueType: input.issueType,
        severity: input.severity,
        confidence: input.confidence,
        description: input.description,
        latitude: input.latitude,
        longitude: input.longitude,
        address: input.address,
        imageUrl: input.imageUrl ?? null,
        status: "submitted",
        priorityScore: priorityBySeverity[input.severity] ?? 1,
      })
      .returning();
    await tx.insert(complaintHistoryTable).values({
      complaintId: created.id,
      oldStatus: null,
      newStatus: "submitted",
      changedBy: req.user.id,
      note: "Complaint submitted",
    });
    return created;
  });
  res
    .status(201)
    .json(
      CreateComplaintResponse.parse(
        toComplaint(
          complaint,
          fullName(req.user.firstName, req.user.lastName),
          true,
        ),
      ),
    );
});

router.get("/complaints/:id", async (req, res): Promise<void> => {
  const params = GetComplaintParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [complaint] = await db
    .select()
    .from(complaintsTable)
    .where(eq(complaintsTable.id, params.data.id))
    .limit(1);
  if (!complaint) {
    res.status(404).json({ error: "Complaint not found." });
    return;
  }
  const canReadPhoto =
    req.isAuthenticated() &&
    (req.user.role === "authority" || req.user.id === complaint.userId);
  res.json(
    GetComplaintResponse.parse(
      toComplaint(complaint, "Community member", canReadPhoto),
    ),
  );
});

router.get("/complaints/:id/history", async (req, res): Promise<void> => {
  const params = GetComplaintHistoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const rows = await db
    .select({
      id: complaintHistoryTable.id,
      complaintId: complaintHistoryTable.complaintId,
      oldStatus: complaintHistoryTable.oldStatus,
      newStatus: complaintHistoryTable.newStatus,
      note: complaintHistoryTable.note,
      createdAt: complaintHistoryTable.createdAt,
      role: usersTable.role,
    })
    .from(complaintHistoryTable)
    .innerJoin(usersTable, eq(complaintHistoryTable.changedBy, usersTable.id))
    .where(eq(complaintHistoryTable.complaintId, params.data.id))
    .orderBy(complaintHistoryTable.createdAt);
  res.json(
    GetComplaintHistoryResponse.parse(
      rows.map(({ role, ...row }) => ({
        ...row,
        changedBy: role === "authority" ? "Authority team" : "Resident",
      })),
    ),
  );
});

router.patch("/complaints/:id/status", async (req, res): Promise<void> => {
  if (!req.isAuthenticated() || req.user.role !== "authority") {
    res.status(403).json({ error: "Authority access is required." });
    return;
  }
  const params = UpdateComplaintStatusParams.safeParse(req.params);
  const parsed = UpdateComplaintStatusBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({
      error: !params.success ? params.error.message : !parsed.success ? parsed.error.message : "Invalid request",
    });
    return;
  }
  const [existing] = await db
    .select()
    .from(complaintsTable)
    .where(eq(complaintsTable.id, params.data.id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Complaint not found." });
    return;
  }
  const note = parsed.data.note?.trim() || null;
  const complaint = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(complaintsTable)
      .set({
        status: parsed.data.status,
        authorityNotes: note
          ? [existing.authorityNotes, note].filter(Boolean).join("\n\n")
          : existing.authorityNotes,
        updatedAt: new Date(),
      })
      .where(eq(complaintsTable.id, existing.id))
      .returning();
    await tx.insert(complaintHistoryTable).values({
      complaintId: existing.id,
      oldStatus: existing.status,
      newStatus: parsed.data.status,
      changedBy: req.user.id,
      note,
    });
    return updated;
  });
  res.json(
    UpdateComplaintStatusResponse.parse(
      toComplaint(complaint, "Community member"),
    ),
  );
});

router.get("/map/complaints", async (req, res): Promise<void> => {
  const parsed = ListMapComplaintsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const conditions = [];
  if (parsed.data.issueType) {
    conditions.push(eq(complaintsTable.issueType, parsed.data.issueType));
  }
  if (parsed.data.severity && severities.includes(parsed.data.severity)) {
    conditions.push(eq(complaintsTable.severity, parsed.data.severity));
  }
  const safeStatus = statusFilter(parsed.data.status);
  if (safeStatus) conditions.push(eq(complaintsTable.status, safeStatus));
  const rows = await db
    .select()
    .from(complaintsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(complaintsTable.priorityScore), desc(complaintsTable.createdAt))
    .limit(500);
  res.json(ListMapComplaintsResponse.parse(rows.map((row) => toComplaint(row))));
});

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      status: complaintsTable.status,
      severity: complaintsTable.severity,
    })
    .from(complaintsTable);
  const resolved = rows.filter((row) => row.status === "resolved").length;
  res.json(
    GetDashboardSummaryResponse.parse({
      issuesReported: rows.length,
      issuesResolved: resolved,
      activeComplaints: rows.length - resolved,
      highPriority: rows.filter((row) =>
        ["high", "critical"].includes(row.severity),
      ).length,
    }),
  );
});

export default router;
