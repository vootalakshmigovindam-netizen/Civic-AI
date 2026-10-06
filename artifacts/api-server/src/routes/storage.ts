import { Readable } from "stream";
import {
  FinalizeComplaintImageUploadBody,
  FinalizeComplaintImageUploadResponse,
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { Router, type IRouter } from "express";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { ObjectPermission } from "../lib/objectAcl";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();
const maxImageSize = 8 * 1024 * 1024;
const acceptedExtensions: Record<string, string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
};

router.post("/storage/uploads/request-url", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in before uploading a photo." });
    return;
  }
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "The photo upload details are invalid." });
    return;
  }
  const { name, size, contentType } = parsed.data;
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  if (
    size > maxImageSize ||
    !acceptedExtensions[contentType]?.includes(extension) ||
    /[\\/]/.test(name) ||
    name.includes("..")
  ) {
    res.status(400).json({
      error: "Use a JPG, PNG, or WEBP image smaller than 8 MB.",
    });
    return;
  }
  try {
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
        metadata: { name, size, contentType },
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Error generating complaint photo upload URL");
    res.status(500).json({ error: "Could not start the photo upload." });
  }
});

router.post("/storage/objects/acl", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in to finish uploading a photo." });
    return;
  }
  const parsed = FinalizeComplaintImageUploadBody.safeParse(req.body);
  if (
    !parsed.success ||
    !parsed.data.objectPath.startsWith("/objects/uploads/") ||
    parsed.data.objectPath.includes("..")
  ) {
    res.status(400).json({ error: "The uploaded photo path is invalid." });
    return;
  }
  try {
    const securedPath = await objectStorageService.trySetObjectEntityAclPolicy(
      parsed.data.objectPath,
      { owner: req.user.id, visibility: "private" },
    );
    const relativePath = securedPath.replace(/^\/objects\//, "");
    res.json(
      FinalizeComplaintImageUploadResponse.parse({
        imageUrl: `/api/storage/objects/${relativePath}`,
      }),
    );
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "The uploaded photo was not found." });
      return;
    }
    req.log.error({ err: error }, "Error securing complaint photo");
    res.status(500).json({ error: "Could not finish the photo upload." });
  }
});

router.get("/storage/objects/*objectPath", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in to view this complaint photo." });
    return;
  }
  const rawPath = req.params.objectPath;
  const wildcardPath = Array.isArray(rawPath) ? rawPath.join("/") : rawPath;
  if (wildcardPath.includes("..")) {
    res.status(400).json({ error: "Invalid photo path." });
    return;
  }
  try {
    const objectFile = await objectStorageService.getObjectEntityFile(
      `/objects/${wildcardPath}`,
    );
    const canRead =
      req.user.role === "authority" ||
      (await objectStorageService.canAccessObjectEntity({
        userId: req.user.id,
        objectFile,
        requestedPermission: ObjectPermission.READ,
      }));
    if (!canRead) {
      res.status(403).json({ error: "You cannot view this complaint photo." });
      return;
    }
    const response = await objectStorageService.downloadObject(objectFile);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
      Readable.fromWeb(
        response.body as ReadableStream<Uint8Array>,
      ).pipe(res);
      return;
    }
    res.end();
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Photo not found." });
      return;
    }
    req.log.error({ err: error }, "Error serving complaint photo");
    res.status(500).json({ error: "Could not load this complaint photo." });
  }
});

router.get("/storage/public-objects/*filePath", async (req, res): Promise<void> => {
  const rawPath = req.params.filePath;
  const filePath = Array.isArray(rawPath) ? rawPath.join("/") : rawPath;
  try {
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found." });
      return;
    }
    const response = await objectStorageService.downloadObject(file);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
      Readable.fromWeb(
        response.body as ReadableStream<Uint8Array>,
      ).pipe(res);
      return;
    }
    res.end();
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Could not load this public asset." });
  }
});

export default router;
