import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { CircleMarker, MapContainer, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { useAuth } from '@workspace/replit-auth-web';
import {
  useAnalyzeImage, useCreateComplaint, useGetComplaint, useGetComplaintHistory,
  useGetDashboardSummary, useListComplaints, useListMapComplaints,
  useListMyComplaints, useUpdateComplaintStatus, useRequestUploadUrl,
  useFinalizeComplaintImageUpload,
  getGetComplaintHistoryQueryKey, getGetComplaintQueryKey, getGetDashboardSummaryQueryKey,
  getListComplaintsQueryKey, getListMapComplaintsQueryKey, getListMyComplaintsQueryKey,
} from '@workspace/api-client-react';
import type { Complaint, ComplaintStatusUpdateStatus, ImageAnalysis } from '@workspace/api-client-react';
import {
  ArrowLeft, ArrowRight, ArrowUpRight, BadgeCheck, BarChart3, Check,
  CheckCircle2, ChevronDown, CircleAlert, Clock3, FileImage, Filter, LocateFixed,
  LogIn, LogOut, MapPin, Menu, MessageSquareText, Navigation, Plus, Search, ShieldCheck,
  Sparkles, Upload, X,
} from 'lucide-react';

const statuses = ['submitted', 'under_review', 'assigned', 'in_progress', 'resolved', 'rejected'];
const statusLabel = (s?: string | null) => (s || 'submitted').replaceAll('_', ' ');
const issueMark = (s?: string) => (s || 'Public service').replaceAll('_', ' ').replace(/\b\w/g, (m) => m.toUpperCase());
const issueOptions = [
  ['pothole', 'Pothole'], ['streetlight', 'Streetlight'], ['sidewalk', 'Sidewalk'],
  ['damaged_road', 'Road damage'], ['graffiti', 'Graffiti'], ['drainage', 'Drainage'],
  ['traffic_signal', 'Traffic signal'], ['public_space', 'Public space'],
  ['water_leak', 'Water leak'], ['garbage', 'Garbage'], ['fallen_tree', 'Fallen tree'],
  ['other', 'Other'],
] as const;
const prettyDate = (value?: string) => value ? new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value)) : 'Recently';
const firstName = (user: any) => user?.firstName || user?.email?.split('@')[0] || 'neighbor';

function Header({ compact = false }: { compact?: boolean }) {
  const { user, isAuthenticated, login, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  return <header className="site-header">
    <div className="header-inner">
      <Link href="/" className="brand" data-testid="link-home"><span className="brand-seal"><Navigation size={17} /></span><span>Civic<span className="brand-ai">AI</span><small>YOUR NEIGHBORHOOD, HEARD</small></span></Link>
      <button className="mobile-menu" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle navigation" data-testid="button-mobile-menu"><Menu size={21} /></button>
      <nav className={`main-nav ${menuOpen ? 'open' : ''}`}>
        <Link href="/map" data-testid="link-map">Community map</Link>
        <Link href="/report" data-testid="link-report">Report an issue</Link>
        {isAuthenticated && <Link href="/dashboard" data-testid="link-dashboard">My reports</Link>}
        {isAuthenticated && user?.role === 'authority' && <Link href="/authority" data-testid="link-authority">Authority</Link>}
        {!compact && (isAuthenticated
          ? <button className="nav-login" onClick={logout} data-testid="button-logout"><LogOut size={15} /> Log out</button>
          : <button className="nav-login" onClick={login} data-testid="button-login"><LogIn size={15} /> Log in</button>)}
      </nav>
    </div>
  </header>;
}

function PageFrame({ children }: { children: ReactNode }) {
  return <div className="app-frame"><Header /><main>{children}</main><footer className="footer"><div className="footer-inner"><span className="footer-brand">CivicAI <span>·</span> Small fixes, stronger neighborhoods.</span><span>Public reports are visible to everyone. Personal details stay private.</span><Link href="/map">Explore the community map <ArrowRight size={14} /></Link></div></footer></div>;
}

function SectionEyebrow({ children }: { children: ReactNode }) {
  return <div className="eyebrow"><span className="eyebrow-line" />{children}</div>;
}

function StatusPill({ status }: { status?: string | null }) {
  const statusClass = (status || 'submitted').replaceAll('_', '-');
  return <span className={`status-pill status-${statusClass}`} data-testid={`status-${statusClass}`}><i />{statusLabel(status)}</span>;
}

function SeverityTag({ severity }: { severity?: string }) {
  return <span className={`severity severity-${(severity || 'medium').toLowerCase()}`}>{severity || 'Medium'} priority</span>;
}

function QueryProblem({ retry, label = 'We couldn’t load this just now.' }: { retry: () => void; label?: string }) {
  return <div className="query-problem"><CircleAlert size={23} /><div><strong>{label}</strong><p>Your reports are safe. Try again in a moment.</p><button className="text-button" onClick={retry} data-testid="button-retry">Try again <ArrowRight size={14} /></button></div></div>;
}

function LocationClickCapture({ onSelect }: { onSelect: (latitude: number, longitude: number) => void }) {
  useMapEvents({ click(event) { onSelect(event.latlng.lat, event.latlng.lng); } });
  return null;
}

function MapCenter({ center, zoom = 13 }: { center: [number, number]; zoom?: number }) {
  const map = useMap();
  useEffect(() => { map.setView(center, zoom); }, [map, center[0], center[1], zoom]);
  return null;
}

function FitMapToReports({ reports }: { reports: Complaint[] }) {
  const map = useMap();
  useEffect(() => {
    if (reports.length === 1) {
      map.setView([reports[0].latitude, reports[0].longitude], 13);
    } else if (reports.length > 1) {
      const bounds = reports.map((report) => [report.latitude, report.longitude] as [number, number]);
      map.fitBounds(bounds, { padding: [36, 36], maxZoom: 13 });
    }
  }, [map, reports]);
  return null;
}

function ComplaintRow({ complaint, compact = false }: { complaint: Complaint; compact?: boolean }) {
  return <Link href={`/complaints/${complaint.id}`} className={`complaint-row ${compact ? 'compact' : ''}`} data-testid={`link-complaint-${complaint.id}`}>
    <div className="complaint-thumb">{complaint.imageUrl ? <img src={complaint.imageUrl} alt="" /> : <MapPin size={20} />}</div>
    <div className="complaint-main"><div className="row-top"><strong>{issueMark(complaint.issueType)}</strong><span className="complaint-number">#{complaint.complaintNumber}</span></div><p>{complaint.address || 'Location not specified'}</p><div className="row-bottom"><StatusPill status={complaint.status} /><span className="row-date">{prettyDate(complaint.updatedAt || complaint.createdAt)}</span></div></div>
    <ArrowRight className="row-arrow" size={17} />
  </Link>;
}

function LandingPage() {
  const summaryQuery = useGetDashboardSummary();
  const summary = summaryQuery.data;
  return <PageFrame>
    <section className="hero wrap">
      <div className="hero-copy reveal"><SectionEyebrow>PUBLIC SERVICE, MADE PERSONAL</SectionEyebrow><h1>See something<br />that needs <em>care?</em></h1><p className="hero-lead">From a broken streetlight to a rough stretch of sidewalk, make your neighborhood’s needs visible—and follow every fix along the way.</p>
        <div className="hero-actions"><Link href="/report" className="button button-primary" data-testid="link-start-report">Report an issue <ArrowRight size={17} /></Link><Link href="/map" className="button button-outline" data-testid="link-explore-map">Explore the map <MapPin size={16} /></Link></div>
        <div className="hero-note"><span className="note-check"><Check size={13} /></span>Log in to submit securely. Your updates are public, progress is trackable.</div>
      </div>
      <div className="hero-art reveal delay-1" aria-label="Illustration of a neighborhood map with a reported street repair"><div className="art-sun" /><div className="art-label art-label-one"><span className="art-pin"><MapPin size={15} /></span><span><b>Streetlight out</b><small>Under review · 0.3 mi</small></span></div><div className="art-label art-label-two"><span className="art-pin art-pin-gold"><Check size={15} /></span><span><b>Sidewalk repaired</b><small>Resolved · 2 days ago</small></span></div><div className="art-route route-a" /><div className="art-route route-b" /><div className="art-block block-a" /><div className="art-block block-b" /><div className="art-block block-c" /><div className="art-block block-d" /><div className="art-block block-e" /><div className="art-park"><span>JUNIPER<br />COMMON</span></div><div className="art-road road-one" /><div className="art-road road-two" /><div className="art-road road-three" /><div className="art-caption"><span className="live-dot" /> THE NEIGHBORHOOD, IN THE KNOW</div></div>
    </section>
    <section className="impact-band"><div className="wrap impact-inner"><div className="impact-intro"><SectionEyebrow>COMMUNITY IN MOTION</SectionEyebrow><h2>Better blocks start<br />with one good report.</h2></div><div className="impact-stat"><strong>{summaryQuery.isLoading ? '—' : summary?.issuesReported ?? '—'}</strong><span>issues brought forward</span></div><div className="impact-stat"><strong>{summaryQuery.isLoading ? '—' : summary?.issuesResolved ?? '—'}</strong><span>issues marked resolved</span></div><div className="impact-footnote">{summaryQuery.isError ? <button onClick={() => summaryQuery.refetch()} className="light-link">Refresh community figures</button> : 'A clearer picture of what needs attention, together.'}</div></div></section>
    <section className="how-section wrap"><div className="section-heading"><SectionEyebrow>STRAIGHTFORWARD BY DESIGN</SectionEyebrow><h2>From noticed to <em>sorted.</em></h2><p>One simple report gives the right people the detail they need to act.</p></div><div className="steps-row"><article className="step"><span className="step-number">01</span><div className="step-icon"><FileImage size={21} /></div><h3>Show us what’s happening</h3><p>Take a photo and add a few words. A helpful first look helps the city understand the issue.</p></article><article className="step"><span className="step-number">02</span><div className="step-icon"><MapPin size={21} /></div><h3>Pinpoint the place</h3><p>Drop a pin and confirm the address, so your report reaches the team responsible for that spot.</p></article><article className="step"><span className="step-number">03</span><div className="step-icon"><BadgeCheck size={21} /></div><h3>Follow the progress</h3><p>See when it’s reviewed, assigned, and resolved. Every status change is part of the record.</p></article></div></section>
    <section className="trust-section"><div className="wrap trust-inner"><div><SectionEyebrow>BUILT FOR TRUST</SectionEyebrow><h2>Technology can help<br />us pay <em>closer attention.</em></h2><p>Image analysis can suggest an issue type and priority. It’s a starting point for your review—not a verdict. You stay in control of what gets submitted.</p></div><div className="trust-card"><div className="trust-card-icon"><Sparkles size={19} /></div><div><strong>AI suggestions, clearly labeled</strong><p>We’ll tell you when an analysis is in demo mode, and you can edit every suggestion before it’s shared.</p></div><ArrowUpRight size={18} /></div></div></section>
    <section className="closing-cta wrap"><div><span className="closing-mark">CA</span><div><h2>Know a corner that<br />could use some care?</h2><p>Start a report in just a few steps.</p></div></div><Link href="/report" className="button button-primary" data-testid="link-report-cta">Make a report <ArrowRight size={17} /></Link></section>
  </PageFrame>;
}

function ReportPage() {
  const auth = useAuth();
  const [step, setStep] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<ImageAnalysis | null>(null);
  const [issueType, setIssueType] = useState('pothole');
  const [severity, setSeverity] = useState('medium');
  const [description, setDescription] = useState('');
  const [address, setAddress] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [submitted, setSubmitted] = useState<Complaint | null>(null);
  const [error, setError] = useState('');
  const [analyzeError, setAnalyzeError] = useState('');
  const [, setLocation] = useLocation();
  const client = useQueryClient();
  const analyze = useAnalyzeImage();
  const requestUpload = useRequestUploadUrl();
  const finalizeUpload = useFinalizeComplaintImageUpload();
  const create = useCreateComplaint();

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const onFile = (selected?: File) => {
    if (!selected) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(selected.type)) { setError('Choose a JPG, PNG, or WEBP image.'); return; }
    if (selected.size > 8 * 1024 * 1024) { setError('This photo is larger than 8 MB. Choose a smaller image.'); return; }
    setError('');
    setFile(selected);
    setPreview(URL.createObjectURL(selected));
    setAnalysis(null);
    setImageUrl(null);
  };
  const uploadPhoto = async (selected: File) => {
    const uploadTarget = await requestUpload.mutateAsync({ data: { name: selected.name, size: selected.size, contentType: selected.type as 'image/jpeg' | 'image/png' | 'image/webp' } });
    const transfer = await fetch(uploadTarget.uploadURL, {
      method: 'PUT',
      headers: { 'Content-Type': selected.type },
      body: selected,
    });
    if (!transfer.ok) throw new Error('The photo could not be uploaded. Please try again.');
    const stored = await finalizeUpload.mutateAsync({ data: { objectPath: uploadTarget.objectPath } });
    setImageUrl(stored.imageUrl);
    return stored.imageUrl;
  };
  const handleAnalysis = async () => {
    if (!file) return;
    setAnalyzeError('');
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Could not read this image.'));
        reader.readAsDataURL(file);
      });
      await uploadPhoto(file);
      const result = await analyze.mutateAsync({ data: { imageData: dataUrl } });
      setAnalysis(result);
      setIssueType(result.issueType);
      setSeverity(result.severity);
      setDescription(result.description);
    } catch (e) { setAnalyzeError(e instanceof Error ? e.message : 'Image processing failed. Try again.'); }
  };
  const submit = async () => {
    setError('');
    if (description.trim().length < 8) { setError('Add at least a sentence to help the right team understand.'); return; }
    if (address.trim().length < 2) { setError('Add a nearby address or landmark.'); return; }
    const lat = Number(latitude);
    const lon = Number(longitude);
    if (!latitude.trim() || !longitude.trim() || !Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) { setError('Choose a point on the map or enter valid coordinates.'); return; }
    try {
      const photoUrl = file ? imageUrl || await uploadPhoto(file) : null;
      const result = await create.mutateAsync({ data: { issueType, severity: severity as 'low' | 'medium' | 'high' | 'critical', confidence: analysis?.confidence ?? 0.5, description, latitude: lat, longitude: lon, address, imageUrl: photoUrl } });
      setSubmitted(result);
      await Promise.all([
        client.invalidateQueries({ queryKey: getListMyComplaintsQueryKey() }),
        client.invalidateQueries({ queryKey: getListComplaintsQueryKey() }),
        client.invalidateQueries({ queryKey: getListMapComplaintsQueryKey() }),
        client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }),
      ]);
    } catch (e) { setError(e instanceof Error ? e.message : 'Your report could not be submitted. Please try again.'); }
  };
  if (auth.isLoading) return <PageFrame><div className="center-state wrap"><div className="skeleton-line wide" /><div className="skeleton-line" /></div></PageFrame>;
  if (!auth.isAuthenticated) return <PageFrame><section className="auth-empty wrap reveal"><div className="auth-art"><span className="auth-plant" /><span className="auth-sun" /><span className="auth-shape shape-1" /><span className="auth-shape shape-2" /><span className="auth-shape shape-3" /><MapPin size={28} /></div><SectionEyebrow>NEIGHBORHOOD REPORTING</SectionEyebrow><h1>Your report can<br /><em>make a difference.</em></h1><p>Log in to submit a report, securely upload a photo, and follow updates from the local team.</p><button className="button button-primary" onClick={auth.login} data-testid="button-report-login">Log in to continue <ArrowRight size={16} /></button><small>Your public report won’t show your personal details.</small></section></PageFrame>;
  if (submitted) return <PageFrame><section className="success-wrap wrap reveal"><div className="success-symbol"><CheckCircle2 size={36} /></div><SectionEyebrow>REPORT RECEIVED</SectionEyebrow><h1>Thank you for<br />speaking <em>up.</em></h1><p>Your report is now in the neighborhood record. You can follow every update from your report page.</p><div className="receipt-card"><span>REPORT NUMBER</span><strong>#{submitted.complaintNumber}</strong><StatusPill status={submitted.status} /><small>{submitted.address}</small></div><div className="success-actions"><Link href={`/complaints/${submitted.id}`} className="button button-primary">View report <ArrowRight size={17} /></Link><Link href="/map" className="button button-outline">See the community map <MapPin size={16} /></Link></div></section></PageFrame>;
  return <PageFrame><section className="form-layout wrap">
    <div className="form-intro"><Link href="/" className="back-link"><ArrowLeft size={15} /> Back to home</Link><SectionEyebrow>A GOOD REPORT MAKES A DIFFERENCE</SectionEyebrow><h1>Let’s get this<br /><em>on the map.</em></h1><p>Share what you’ve noticed. We’ll help organize the details so the right local team can take a look.</p><div className="privacy-note"><ShieldCheck size={18} /><div><b>Your privacy matters</b><p>Your name is never shown on the public map. Your report and its progress are.</p></div></div></div>
    <div className="form-card">
      <div className="stepper"><div className={`step-node ${step >= 1 ? 'active' : ''}`}><span>1</span><b>Issue</b></div><span className={`step-line ${step >= 2 ? 'active' : ''}`} /><div className={`step-node ${step >= 2 ? 'active' : ''}`}><span>2</span><b>Location</b></div><span className={`step-line ${step >= 3 ? 'active' : ''}`} /><div className={`step-node ${step >= 3 ? 'active' : ''}`}><span>3</span><b>Review</b></div></div>
      {step === 1 && <div className="form-step reveal"><div className="form-heading"><span className="form-kicker">01 / WHAT NEEDS ATTENTION?</span><h2>Start with a photo.</h2><p>A clear picture helps staff understand the issue before they arrive.</p></div>
         <label className={`upload-zone ${preview ? 'has-image' : ''}`} htmlFor="issue-image" data-testid="dropzone-image">{preview ? <><img src={preview} alt="Selected issue preview" /><button type="button" className="remove-photo" aria-label="Remove selected photo" onClick={(e) => { e.preventDefault(); setFile(null); setPreview(''); setImageUrl(null); setAnalysis(null); }} data-testid="button-remove-photo"><X size={15} /></button></> : <><span className="upload-icon"><Upload size={21} /></span><strong>Choose a photo to upload</strong><span>JPG, PNG or WEBP · up to 8 MB</span><span className="upload-browse">Browse files</span></>}<input id="issue-image" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => onFile(e.target.files?.[0])} data-testid="input-image" /></label>
        {file && <div className="analysis-action"><button className="button button-outline" disabled={analyze.isPending || requestUpload.isPending || finalizeUpload.isPending} onClick={handleAnalysis} data-testid="button-analyze"><Sparkles size={16} />{analyze.isPending || requestUpload.isPending || finalizeUpload.isPending ? 'Taking a closer look…' : analysis ? 'Analyze again' : 'Suggest issue details'}</button><span>Suggestions are optional and can be changed.</span></div>}
        {analyzeError && <div className="inline-error" role="alert">{analyzeError}</div>}
        {analysis && <div className={`analysis-note ${analysis.demoMode ? 'demo-note' : ''}`}><Sparkles size={16} /><div><strong>{analysis.demoMode ? 'Demo suggestion' : 'AI suggestion'}</strong><span>{analysis.demoMode ? 'This is a demo-mode suggestion, not a verified assessment. Please review carefully.' : `Suggested with ${Math.round(analysis.confidence * 100)}% confidence. Please review before submitting.`}</span></div><CheckCircle2 size={16} /></div>}
         <div className="field-grid"><label className="field"><span>Issue type</span><select value={issueType} onChange={(e) => setIssueType(e.target.value)} data-testid="select-issue-type">{issueOptions.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="field"><span>How urgent does it feel?</span><select value={severity} onChange={(e) => setSeverity(e.target.value)} data-testid="select-severity">{['low','medium','high','critical'].map(x => <option key={x} value={x}>{x[0].toUpperCase()+x.slice(1)} priority</option>)}</select></label><label className="field full"><span>A few details</span><textarea value={description} maxLength={1200} onChange={(e) => setDescription(e.target.value)} placeholder="What did you notice? Is it getting worse or affecting the way people move through the area?" data-testid="input-description" /><small className="character-count">{description.length}/1200</small></label></div>
         {error && <div className="inline-error" role="alert">{error}</div>}<div className="form-footer"><span>Required fields are marked by their labels.</span><button className="button button-primary" disabled={requestUpload.isPending || finalizeUpload.isPending || analyze.isPending} onClick={() => { if (description.trim().length < 8) { setError('Add at least a sentence to help the right team understand.'); return; } setError(''); setStep(2); }} data-testid="button-next-location">Add location <ArrowRight size={16} /></button></div>
      </div>}
       {step === 2 && <div className="form-step reveal"><div className="form-heading"><span className="form-kicker">02 / WHERE IS IT?</span><h2>Drop a pin nearby.</h2><p>Click the map or use your current location, then add the closest address, intersection, or landmark.</p></div><div className="location-preview report-map-shell"><MapContainer center={latitude && longitude ? [Number(latitude), Number(longitude)] : [20, 0]} zoom={latitude && longitude ? 13 : 2} scrollWheelZoom={false} className="report-leaflet-map"><TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" /><LocationClickCapture onSelect={(lat, lon) => { setLatitude(lat.toFixed(6)); setLongitude(lon.toFixed(6)); }} />{latitude && longitude && <><MapCenter center={[Number(latitude), Number(longitude)]} /><CircleMarker center={[Number(latitude), Number(longitude)]} radius={9} pathOptions={{ color: '#fff', weight: 3, fillColor: '#147360', fillOpacity: 1 }}><Popup>Selected report location</Popup></CircleMarker></>}</MapContainer><button className="locate-button" onClick={() => { if (!navigator.geolocation) { setError('Location access is not available in this browser.'); return; } navigator.geolocation.getCurrentPosition(({ coords }) => { setLatitude(coords.latitude.toFixed(6)); setLongitude(coords.longitude.toFixed(6)); setError(''); }, () => setError('Location permission was denied. Click the map to choose a point instead.'), { enableHighAccuracy: true, timeout: 10000 }); }} data-testid="button-current-location"><LocateFixed size={15} /> Use my location</button></div>
         <div className="field-grid"><label className="field full"><span>Nearby address or landmark</span><input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="e.g. 14 Willow Street, near the library" data-testid="input-address" /></label><label className="field"><span>Latitude</span><input type="number" min="-90" max="90" step="any" value={latitude} onChange={(e) => setLatitude(e.target.value)} data-testid="input-latitude" /></label><label className="field"><span>Longitude</span><input type="number" min="-180" max="180" step="any" value={longitude} onChange={(e) => setLongitude(e.target.value)} data-testid="input-longitude" /></label></div>
        {error && <div className="inline-error" role="alert">{error}</div>}<div className="form-footer"><button className="back-button" onClick={() => setStep(1)} data-testid="button-back-issue"><ArrowLeft size={15} /> Back</button><button className="button button-primary" onClick={() => { if (address.trim().length < 2) { setError('Add a nearby address or landmark first.'); return; } setError(''); setStep(3); }} data-testid="button-review">Review report <ArrowRight size={16} /></button></div>
      </div>}
      {step === 3 && <div className="form-step reveal"><div className="form-heading"><span className="form-kicker">03 / BEFORE YOU SEND</span><h2>Does this look right?</h2><p>Check the details. You can go back and make changes anytime before submitting.</p></div>
        <div className="review-card">{preview && <img className="review-photo" src={preview} alt="Issue submitted" />}<div className="review-lines"><div><span>ISSUE</span><b>{issueMark(issueType)} <SeverityTag severity={severity} /></b></div><div><span>LOCATION</span><b>{address}</b></div><div><span>DETAILS</span><p>{description}</p></div></div></div>
        {analysis?.demoMode && <div className="analysis-note demo-note"><Sparkles size={16} /><div><strong>Demo-mode analysis</strong><span>The suggestion shown above is a demo and has not been verified by an AI model.</span></div></div>}
         {error && <div className="inline-error" role="alert">{error}</div>}<div className="form-footer"><button className="back-button" onClick={() => setStep(2)} data-testid="button-back-location"><ArrowLeft size={15} /> Back</button><button className="button button-primary" disabled={create.isPending || requestUpload.isPending || finalizeUpload.isPending} onClick={submit} data-testid="button-submit-report">{create.isPending || requestUpload.isPending || finalizeUpload.isPending ? 'Sending report…' : 'Submit report'}{!create.isPending && <ArrowRight size={16} />}</button></div>
      </div>}
    </div>
  </section></PageFrame>;
}

function MapPage() {
  const [issueFilter, setIssueFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState<Complaint | null>(null);
  const params = useMemo(() => ({ ...(issueFilter ? { issueType: issueFilter } : {}), ...(statusFilter ? { status: statusFilter } : {}) }), [issueFilter, statusFilter]);
  const query = useListMapComplaints(params);
  const reports = query.data || [];
  return <PageFrame><section className="map-page wrap"><div className="map-page-heading"><div><SectionEyebrow>OPEN NEIGHBORHOOD RECORD</SectionEyebrow><h1>Community <em>map.</em></h1><p>See the local issues people have raised and how they’re moving forward.</p></div><Link href="/report" className="button button-primary" data-testid="link-map-report"><Plus size={16} /> Add a report</Link></div>
    <div className="map-toolbar"><div className="map-count"><span className="live-dot" /><b>{query.isLoading ? '…' : reports.length}</b> public reports</div><div className="map-filters"><Filter size={15} /><select aria-label="Filter by issue" value={issueFilter} onChange={e => setIssueFilter(e.target.value)} data-testid="filter-map-issue"><option value="">All issue types</option>{issueOptions.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><select aria-label="Filter by status" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} data-testid="filter-map-status"><option value="">All statuses</option>{statuses.map(x=><option key={x} value={x}>{statusLabel(x)}</option>)}</select></div></div>
    <div className="map-workspace"><div className="leaflet-public-shell" data-testid="map-canvas"><MapContainer center={[20, 0]} zoom={2} scrollWheelZoom className="public-leaflet-map"><TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" /><FitMapToReports reports={reports} />{reports.map(c => <CircleMarker key={c.id} center={[c.latitude, c.longitude]} radius={selected?.id === c.id ? 10 : 7} pathOptions={{ color: '#fff', weight: 2, fillColor: ['high','critical'].includes(c.severity) ? '#c85b39' : '#187b69', fillOpacity: 0.95 }} eventHandlers={{ click: () => setSelected(c) }}><Popup><div className="leaflet-report-popup"><small>#{c.complaintNumber}</small><strong>{issueMark(c.issueType)}</strong><span>{c.address}</span><StatusPill status={c.status} /><Link href={`/complaints/${c.id}`}>View report <ArrowRight size={13} /></Link></div></Popup></CircleMarker>)}</MapContainer>{query.isError && <div className="leaflet-error"><QueryProblem retry={() => query.refetch()} label="The map reports couldn’t be loaded." /></div>}{!query.isLoading && !query.isError && reports.length === 0 && <div className="map-empty leaflet-empty">No reports match these filters.<button onClick={() => { setIssueFilter(''); setStatusFilter(''); }}>Clear filters</button></div>}</div><aside className="map-aside"><div className="map-aside-head"><div><span>REPORTS NEARBY</span><b>{query.isLoading ? 'Loading' : `${reports.length} reports`}</b></div><span className="list-sort">Recently updated <ChevronDown size={13} /></span></div>{query.isError ? <QueryProblem retry={() => query.refetch()} /> : reports.length === 0 && !query.isLoading ? <div className="empty-card map-list-empty"><span className="empty-icon"><MapPin size={19} /></span><b>A little quiet here.</b><p>No reports found with those filters. Try widening your search.</p><button className="text-button" onClick={() => { setIssueFilter(''); setStatusFilter(''); }}>Clear filters</button></div> : <div className="map-list">{query.isLoading ? Array.from({length:4},(_,i)=><div className="skeleton-row" key={i} />) : reports.slice(0,8).map(c=><button className={`map-list-item ${selected?.id===c.id?'active':''}`} key={c.id} onClick={() => setSelected(c)} data-testid={`button-select-report-${c.id}`}><span className={`list-priority priority-${c.severity}`} /><div><b>{issueMark(c.issueType)}</b><span>{c.address}</span><span className="list-meta"><StatusPill status={c.status} /> · {prettyDate(c.updatedAt)}</span></div><ArrowRight size={15} /></button>)}</div>}<div className="map-key"><span><i className="key-dot" />Routine</span><span><i className="key-dot key-hot" />Priority</span></div></aside></div><div className="map-disclaimer"><ShieldCheck size={16} /><span>OpenStreetMap markers show approximate locations. Personal details are never displayed publicly.</span></div></section></PageFrame>;
}

function DashboardPage() {
  const auth = useAuth();
  const reportsQuery = useListMyComplaints({ query: { enabled: auth.isAuthenticated, queryKey: getListMyComplaintsQueryKey() } });
  const summaryQuery = useGetDashboardSummary();
  const reports = reportsQuery.data || [];
  const active = reports.filter(r => !['resolved','rejected'].includes(r.status)).length;
  const resolved = reports.filter(r => r.status === 'resolved').length;
  if (auth.isLoading) return <PageFrame><div className="center-state wrap"><div className="skeleton-line wide" /><div className="skeleton-line" /><div className="skeleton-row" /></div></PageFrame>;
  if (!auth.isAuthenticated) return <PageFrame><section className="auth-empty wrap reveal"><div className="auth-art"><span className="auth-plant" /><span className="auth-sun" /><span className="auth-shape shape-1" /><span className="auth-shape shape-2" /><span className="auth-shape shape-3" /><MapPin size={28} /></div><SectionEyebrow>YOUR NEIGHBORHOOD ACCOUNT</SectionEyebrow><h1>Your reports,<br /><em>all in one place.</em></h1><p>Log in to follow your reports, see status changes, and stay in the loop when local teams respond.</p><button className="button button-primary" onClick={auth.login} data-testid="button-dashboard-login">Log in to continue <ArrowRight size={16} /></button><small>Don’t have a report yet? <Link href="/report">You can report an issue without logging in.</Link></small></section></PageFrame>;
  return <PageFrame><section className="dashboard-page wrap"><div className="dash-greeting"><div><SectionEyebrow>YOUR CIVICAI SPACE</SectionEyebrow><h1>Good to see you, <em>{firstName(auth.user)}.</em></h1><p>Here’s the latest on the things you’ve brought to your neighborhood’s attention.</p></div><Link href="/report" className="button button-primary" data-testid="link-dashboard-report"><Plus size={16} /> New report</Link></div>
    <div className="summary-grid"><div className="summary-card summary-feature"><span className="summary-label">YOUR REPORTS</span><strong>{reportsQuery.isLoading ? '—' : reports.length}</strong><span>issues brought forward</span><div className="summary-glyph"><MessageSquareText size={20} /></div></div><div className="summary-card"><span className="summary-label">IN PROGRESS</span><strong>{reportsQuery.isLoading ? '—' : active}</strong><span>with local teams</span><div className="summary-glyph"><Clock3 size={19} /></div></div><div className="summary-card"><span className="summary-label">RESOLVED</span><strong>{reportsQuery.isLoading ? '—' : resolved}</strong><span>marked complete</span><div className="summary-glyph resolved-glyph"><CheckCircle2 size={19} /></div></div></div>
    <div className="dash-content"><div className="reports-panel"><div className="panel-heading"><div><span className="panel-kicker">YOUR ACTIVITY</span><h2>Reports you’ve made</h2></div><span>{reports.length} total</span></div>{reportsQuery.isError ? <QueryProblem retry={() => reportsQuery.refetch()} /> : reportsQuery.isLoading ? <div className="loading-rows"><div className="skeleton-row" /><div className="skeleton-row" /><div className="skeleton-row" /></div> : reports.length === 0 ? <div className="empty-card"><span className="empty-icon"><MapPin size={18} /></span><b>Your first report starts a conversation.</b><p>When you spot something that needs care, add a report here. Your updates will live in this space.</p><Link href="/report" className="text-button">Make your first report <ArrowRight size={14} /></Link></div> : <div className="complaint-list">{reports.map(r=><ComplaintRow key={r.id} complaint={r} />)}</div>}</div>
      <aside className="dash-side"><div className="side-note"><div className="side-note-mark"><BarChart3 size={18} /></div><span className="panel-kicker">A SHARED EFFORT</span><h3>Small reports add up.</h3><p>Every clear, specific report helps local teams see patterns and decide what needs attention first.</p><Link href="/map">See what neighbors are reporting <ArrowRight size={14} /></Link></div><div className="community-total"><span>IN YOUR COMMUNITY</span><strong>{summaryQuery.isLoading ? '—' : summaryQuery.data?.issuesResolved ?? '—'} <small>resolved</small></strong><p>Reported issues marked resolved by local teams.</p>{summaryQuery.isError && <button onClick={() => summaryQuery.refetch()} className="text-button">Refresh figure</button>}</div></aside></div></section></PageFrame>;
}

function ComplaintDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const detail = useGetComplaint(id, { query: { enabled: Number.isFinite(id) && id > 0, queryKey: getGetComplaintQueryKey(id) } });
  const history = useGetComplaintHistory(id, { query: { enabled: Number.isFinite(id) && id > 0, queryKey: getGetComplaintHistoryQueryKey(id) } });
  const c = detail.data;
  return <PageFrame><section className="detail-page wrap"><Link href="/map" className="back-link"><ArrowLeft size={15} /> Back to community map</Link>{detail.isLoading ? <div className="detail-skeleton"><div className="skeleton-line" /><div className="skeleton-line wide" /><div className="skeleton-row" /></div> : detail.isError || !c ? <div className="detail-error"><CircleAlert size={24} /><h2>This report isn’t available.</h2><p>It may have been removed, or there was a problem loading it.</p><button className="button button-outline" onClick={() => detail.refetch()}>Try again</button><Link href="/map" className="text-button">Return to map</Link></div> : <><div className="detail-heading"><div><SectionEyebrow>COMMUNITY REPORT · #{c.complaintNumber}</SectionEyebrow><h1>{issueMark(c.issueType)} <em>report.</em></h1><p><MapPin size={16} />{c.address}</p></div><StatusPill status={c.status} /></div><div className="detail-grid"><div className="detail-primary">{c.imageUrl && <div className="detail-image"><img src={c.imageUrl} alt={`Reported ${c.issueType}`} /></div>}<article className="detail-description"><span className="panel-kicker">WHAT WAS NOTICED</span><p>{c.description}</p><div className="detail-meta"><SeverityTag severity={c.severity} /><span>Reported {prettyDate(c.createdAt)}</span></div></article>{c.authorityNotes && <article className="authority-note"><span><MessageSquareText size={16} /> NOTE FROM THE LOCAL TEAM</span><p>{c.authorityNotes}</p></article>}<div className="map-location-card map-grid"><div className="map-road map-road-a" /><div className="map-road map-road-b" /><div className="map-green" /><MapPin size={30} fill="currentColor" /><span>{c.address}</span><small>Approximate location</small></div></div><aside className="timeline-card"><span className="panel-kicker">STATUS TIMELINE</span><h2>Where things stand</h2>{history.isError ? <QueryProblem retry={() => history.refetch()} label="The timeline couldn’t be loaded." /> : history.isLoading ? <div className="timeline-skeleton"><div className="skeleton-line" /><div className="skeleton-line" /><div className="skeleton-line" /></div> : !history.data?.length ? <div className="timeline-empty"><Clock3 size={19} /><p>Status updates will appear here as this report is reviewed.</p></div> : <div className="timeline">{history.data.map((h,i)=><div className="timeline-entry" key={h.id}><span className={`timeline-point ${i===0?'current':''}`} /><div><div className="timeline-entry-head"><b>{statusLabel(h.newStatus)}</b><time>{prettyDate(h.createdAt)}</time></div><span className="timeline-by">Updated by {h.changedBy}</span>{h.note && <p>{h.note}</p>}</div></div>)}</div>}<div className="timeline-foot"><ShieldCheck size={15} />Every update is part of the public record.</div></aside></div><div className="detail-footer"><span>Know something helpful? Add another report to the community map.</span><Link href="/report" className="button button-outline"><Plus size={15} /> Make another report</Link></div></>}</section></PageFrame>;
}

function AuthorityPage() {
  const auth = useAuth();
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Complaint | null>(null);
  const [newStatus, setNewStatus] = useState<ComplaintStatusUpdateStatus>('under_review');
  const [note, setNote] = useState('');
  const [updateError, setUpdateError] = useState('');
  const client = useQueryClient();
  const params = useMemo(() => ({ ...(statusFilter ? { status: statusFilter } : {}), ...(search.trim() ? { search: search.trim() } : {}) }), [statusFilter, search]);
  const query = useListComplaints(params);
  const mutation = useUpdateComplaintStatus();
  const reports = query.data || [];
  const close = () => { setSelected(null); setNote(''); setUpdateError(''); };
  const saveStatus = async () => {
    if (!selected) return;
    setUpdateError('');
    try {
      await mutation.mutateAsync({ id: selected.id, data: { status: newStatus, ...(note.trim() ? { note: note.trim() } : {}) } });
      await Promise.all([
        client.invalidateQueries({ queryKey: getListComplaintsQueryKey() }),
        client.invalidateQueries({ queryKey: getListMapComplaintsQueryKey() }),
        client.invalidateQueries({ queryKey: getListMyComplaintsQueryKey() }),
        client.invalidateQueries({ queryKey: getGetComplaintQueryKey(selected.id) }),
        client.invalidateQueries({ queryKey: getGetComplaintHistoryQueryKey(selected.id) }),
        client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }),
      ]);
      close();
    } catch (e) { setUpdateError(e instanceof Error ? e.message : 'The status could not be updated. Please try again.'); }
  };
  if (auth.isLoading) return <PageFrame><div className="center-state wrap"><div className="skeleton-line wide" /><div className="skeleton-row" /></div></PageFrame>;
  if (!auth.isAuthenticated) return <PageFrame><section className="authority-gate wrap"><div className="gate-mark"><ShieldCheck size={24} /></div><SectionEyebrow>LOCAL TEAM ACCESS</SectionEyebrow><h1>For the people<br />who <em>keep it moving.</em></h1><p>Sign in with your work account to access the local team workspace.</p><button className="button button-primary" onClick={auth.login} data-testid="button-authority-login">Log in to continue <ArrowRight size={16} /></button><small>Team access is limited to accounts authorized by your local administrator.</small></section></PageFrame>;
  if (auth.user?.role !== 'authority') return <PageFrame><section className="authority-gate wrap"><div className="gate-mark"><ShieldCheck size={24} /></div><SectionEyebrow>LOCAL TEAM ACCESS</SectionEyebrow><h1>This space is for<br /><em>authorized teams.</em></h1><p>This account doesn’t have authority access. If you believe this is a mistake, contact your local administrator.</p><button className="button button-outline" onClick={auth.logout} data-testid="button-authority-logout"><LogOut size={15} /> Log out</button></section></PageFrame>;
  return <PageFrame><section className="authority-page wrap"><div className="authority-heading"><div><SectionEyebrow>LOCAL AUTHORITY WORKSPACE</SectionEyebrow><h1>Good morning, <em>{firstName(auth.user)}.</em></h1><p>Review new reports, set priorities, and let neighbors know what’s happening.</p></div><div className="authority-secure"><ShieldCheck size={16} /><span>Authorized staff</span></div></div><div className="authority-topline"><div className="authority-stat"><strong>{query.isLoading ? '—' : reports.length}</strong><span>matching reports</span></div><div className="authority-stat urgent-stat"><strong>{query.isLoading ? '—' : reports.filter(r=>['high','critical'].includes(r.severity)).length}</strong><span>high priority</span></div><div className="authority-stat"><strong>{query.isLoading ? '—' : reports.filter(r=>r.status==='submitted').length}</strong><span>awaiting review</span></div></div>
    <div className="authority-tools"><div className="authority-search"><Search size={16} /><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search address or report number" data-testid="input-authority-search" /></div><select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} data-testid="filter-authority-status"><option value="">All statuses</option>{statuses.map(x=><option key={x} value={x}>{statusLabel(x)}</option>)}</select><button className="button button-outline" onClick={()=>query.refetch()} data-testid="button-refresh-authority"><ArrowRight size={15} /> Refresh</button></div>
    <div className="authority-table-wrap">{query.isError ? <QueryProblem retry={()=>query.refetch()} /> : query.isLoading ? <div className="loading-rows"><div className="skeleton-row" /><div className="skeleton-row" /><div className="skeleton-row" /></div> : reports.length===0 ? <div className="empty-card authority-empty"><span className="empty-icon"><CheckCircle2 size={19} /></span><b>No reports in this view.</b><p>Try another status or search term. New public reports will appear here.</p><button className="text-button" onClick={()=>{setStatusFilter('');setSearch('');}}>Clear filters</button></div> : <table className="authority-table"><thead><tr><th>REPORT</th><th>LOCATION</th><th>PRIORITY</th><th>STATUS</th><th>UPDATED</th><th></th></tr></thead><tbody>{reports.map(c=><tr key={c.id} data-testid={`row-authority-${c.id}`}><td><span className="table-report"><b>{issueMark(c.issueType)}</b><small>#{c.complaintNumber}</small></span></td><td className="table-location">{c.address}</td><td><SeverityTag severity={c.severity} /></td><td><StatusPill status={c.status} /></td><td className="table-date">{prettyDate(c.updatedAt)}</td><td><button className="manage-button" onClick={()=>{setSelected(c);setNewStatus((statuses.includes(c.status)?c.status:'under_review') as ComplaintStatusUpdateStatus);setNote('');}} data-testid={`button-manage-${c.id}`}>Manage <ArrowRight size={13} /></button></td></tr>)}</tbody></table>}</div><div className="authority-footnote"><ShieldCheck size={15} />Every status update appears on the public report timeline.</div>
    {selected && <div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)close();}}><section className="manage-modal" role="dialog" aria-modal="true" aria-labelledby="manage-title"><button className="modal-close" onClick={close} aria-label="Close update form" data-testid="button-close-manage"><X size={18} /></button><span className="panel-kicker">#{selected.complaintNumber} · {issueMark(selected.issueType)}</span><h2 id="manage-title">Update this report</h2><p className="manage-address"><MapPin size={14} />{selected.address}</p><div className="field"><span>Set report status</span><select value={newStatus} onChange={e=>setNewStatus(e.target.value as ComplaintStatusUpdateStatus)} data-testid="select-update-status">{statuses.map(x=><option key={x} value={x}>{statusLabel(x)}</option>)}</select></div><label className="field"><span>Note for the public timeline <small>(optional)</small></span><textarea value={note} maxLength={1200} onChange={e=>setNote(e.target.value)} placeholder="Share a helpful update about what happens next." data-testid="input-authority-note" /></label>{updateError && <div className="inline-error" role="alert">{updateError}</div>}<div className="modal-actions"><button className="back-button" onClick={close}>Cancel</button><button className="button button-primary" disabled={mutation.isPending} onClick={saveStatus} data-testid="button-save-status">{mutation.isPending?'Saving update…':'Save update'}{!mutation.isPending&&<Check size={15}/>}</button></div></section></div>}
  </section></PageFrame>;
}

export { LandingPage, ReportPage, MapPage, DashboardPage, ComplaintDetailPage, AuthorityPage };
