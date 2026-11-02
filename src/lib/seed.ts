import type { Channel, Json, Lead, Stage, Verdict } from "./types";

export type SeedItem = { type: string; data: Json };

const DAY = 86_400_000;

function isoDate(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
}

function isoAt(offsetDays = 0, hour = 9): string {
  const d = new Date(Date.now() + offsetDays * DAY);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

function contact(id: string, name: string, role: string, phone: string, email: string, owner = false) {
  return { id, name, role, phone, whatsapp: phone, email, is_owner: owner };
}

function defect(id: string, text: string, page: string, offset = -8) {
  return { id, text, page, found_at: isoAt(offset, 11) };
}

function touch(id: string, offset: number, channel: Channel, direction: "inbound" | "outbound", outcome: string, note: string, by = "You") {
  return { id, at: isoAt(offset, 10), channel, direction, outcome, note, by };
}

function message(subject: string, body: string, channel: Channel, version = 1) {
  return {
    subject,
    body,
    channel,
    words: body.trim().split(/\s+/).length,
    version,
    generated_at: isoAt(-3, 8),
  };
}

function followup(id: string, offset: number, what: string, done = false) {
  return {
    id,
    due: isoDate(offset),
    what,
    done,
    done_at: done ? isoAt(offset, 16) : null,
    generated: true,
  };
}

type LeadSeed = {
  id: string;
  name: string;
  kind: string;
  town: string;
  address: string;
  url: string;
  platform: string;
  verdict: Verdict;
  proof: string;
  source: string;
  channel: Channel;
  stage: Stage;
  defects: ReturnType<typeof defect>[];
  contacts: ReturnType<typeof contact>[];
  message: ReturnType<typeof message> | null;
  sentOffset?: number;
  followups?: ReturnType<typeof followup>[];
  next?: { text: string; offset: number };
  touches?: ReturnType<typeof touch>[];
  demoUrl?: string;
  reply?: { text: string; offset: number; channel: Channel };
  outcome?: { result: "won" | "lost" | "parked"; reason: string; value?: number; offset: number };
  valueQuoted?: number;
  valuePaid?: number;
  paidAt?: string;
  research?: string;
  tags?: string[];
  archived?: boolean;
};

function lead(seed: LeadSeed): Lead {
  const sent = seed.sentOffset !== undefined ? isoAt(seed.sentOffset, 9) : null;
  const next = seed.next ? { text: seed.next.text, date: isoDate(seed.next.offset) } : null;
  const noSubstance = seed.defects.length === 0 && !seed.message && !next;
  const created = isoAt(-14, 8);
  return {
    id: seed.id,
    name: seed.name,
    kind: seed.kind,
    town: seed.town,
    address: seed.address,
    url: seed.url,
    site_platform: seed.platform,
    screenshot: `https://placehold.co/390x844/f3f4f6/111827?text=${encodeURIComponent(seed.name)}`,
    screenshot_captured_at: isoAt(-9, 14),
    verdict: seed.verdict,
    proof: seed.proof,
    proof_source: seed.source,
    verified_at: isoDate(-9),
    contacts: seed.contacts,
    channel: seed.channel,
    stage: seed.stage,
    stage_changed_at: isoAt(seed.sentOffset ?? -4, 9),
    defects: seed.defects,
    message: seed.message,
    message_history: seed.message ? [seed.message] : [],
    sent: sent ? { at: sent, channel: seed.channel, by: "You" } : null,
    followups: seed.followups ?? [],
    next_action: next,
    touches: seed.touches ?? [],
    demo: seed.demoUrl ? { url: seed.demoUrl, built_at: isoAt(-6, 13), sent_at: seed.stage !== "Sourced" ? isoAt(-5, 10) : null } : null,
    arm: seed.id.endsWith("2") || seed.id.endsWith("4") || seed.id.endsWith("6") ? "B" : "A",
    reply: seed.reply ? { text: seed.reply.text, at: isoAt(seed.reply.offset, 12), channel: seed.reply.channel } : null,
    outcome: seed.outcome ? { ...seed.outcome, at: isoAt(seed.outcome.offset, 15) } : null,
    research: seed.research ?? "Mobile-first opportunity. Confirm owner and decision maker before quoting.",
    value_quoted: seed.valueQuoted ?? null,
    value_paid: seed.valuePaid ?? null,
    paid_at: seed.paidAt ?? null,
    tags: seed.tags ?? [],
    warnings: noSubstance ? ["Bookmark only: no defects, message or next-action date."] : [],
    is_bookmark: noSubstance,
    created_at: created,
    updated_at: isoAt(-1, 16),
    archived_at: seed.archived ? isoAt(-2, 9) : null,
  } as Lead;
}

export function makeSeedRecords(): SeedItem[] {
  const items: SeedItem[] = [];
  const settings: Json = {
    id: "settings",
    cadence_days: [2, 5, 9],
    send_windows: ["08:30", "11:30", "14:30", "16:30"],
    daily_quota: 12,
    ab_split: 50,
    channel_order: ["WhatsApp", "Email", "Call", "Walk-in"],
    timezone_label: "Africa/Johannesburg (UTC+02:00)",
    created_at: isoAt(-30, 8),
    updated_at: isoAt(-1, 8),
  };
  items.push({ type: "settings", data: settings });

  const leads: LeadSeed[] = [
    {
      id: "lead_kc_001", name: "Marula Moon Guest House", kind: "guest house", town: "Rustenburg",
      address: "14 Kloof Street, Rustenburg", url: "https://marulamoon.example.co.za", platform: "WordPress / Divi",
      verdict: "TRADING", proof: "Google reviews updated this month and published nightly rates.", source: "https://maps.example.com/marula-moon",
      channel: "WhatsApp", stage: "Sourced",
      defects: [defect("def_001", "Phone number is buried below three sliders on mobile.", "Home"), defect("def_002", "Booking form fails validation on Safari.", "Contact")],
      contacts: [contact("con_001", "Lerato Mokoena", "Owner", "+27 82 441 0192", "lerato@marulamoon.example.co.za", true), contact("con_002", "Front desk", "Reception", "+27 14 592 3301", "stay@marulamoon.example.co.za")],
      message: message("A quicker booking path for Marula Moon", "Hi Lerato, I noticed the mobile booking form is hard to complete on Safari. I built a small demo that puts rooms, rates and WhatsApp booking above the fold. Would a 2-minute preview be useful?", "WhatsApp"),
      next: { text: "Send first message and stamp it", offset: 0 }, tags: ["saturday-batch", "hospitality"],
      touches: [touch("tch_001", -8, "Call", "outbound", "No answer", "Tried the front desk number.")],
      valueQuoted: 4800,
    },
    {
      id: "lead_kc_002", name: "Ndlovu & Partners Attorneys", kind: "law firm", town: "Pretoria",
      address: "Suite 3, Brooklyn Court", url: "https://ndlovupartners.example.co.za", platform: "Wix",
      verdict: "TRADING", proof: "Active case updates and a current LinkedIn practice page.", source: "https://linkedin.example.com/ndlovu-partners",
      channel: "Email", stage: "Demo built",
      defects: [defect("def_003", "No clear practice-area navigation on mobile.", "Home"), defect("def_004", "Consultation link opens a broken mailto.", "Contact")],
      contacts: [contact("con_003", "Thandi Ndlovu", "Managing Partner", "+27 83 210 7740", "thandi@ndlovupartners.example.co.za", true)],
      message: message("A clearer first impression for Ndlovu & Partners", "Good morning Thandi, your consultation link does not open correctly on mobile. I drafted a clean practice-area landing page with a reliable consultation request. May I send the preview?", "Email", 2),
      next: { text: "Send demo link to managing partner", offset: -2 }, demoUrl: "https://demo.kgomotsoconversions.example/ndlovu", tags: ["professional-services"],
      touches: [touch("tch_002", -5, "Email", "outbound", "Demo built", "Prepared the practice-area demo.")],
      valueQuoted: 7200,
    },
    {
      id: "lead_kc_003", name: "Rustenburg Panel & Spray", kind: "panel beater", town: "Rustenburg",
      address: "8 Industrial Road", url: "https://rpanel.example.co.za", platform: "Old HTML / FrontPage-era",
      verdict: "EXISTS", proof: "Business listing and three recent local reviews, but the site has stale content.", source: "https://directories.example.com/rpanel",
      channel: "WhatsApp", stage: "Sent", sentOffset: -2,
      defects: [defect("def_005", "No click-to-call button on mobile.", "Home"), defect("def_006", "Gallery images take over 8 seconds to load.", "Gallery")],
      contacts: [contact("con_004", "Pieter Botha", "Workshop Manager", "+27 82 556 1188", "pieter@rpanel.example.co.za", true)],
      message: message("Faster quote requests for Rustenburg Panel & Spray", "Hi Pieter, I noticed quote requests are hard to start on a phone. I made a one-page demo with a click-to-call button and a compact photo upload prompt. Happy to show you.", "WhatsApp"),
      followups: [followup("fup_001", 0, "Follow-up 1 — check delivery"), followup("fup_002", 3, "Follow-up 2 — share one useful tip"), followup("fup_003", 7, "Follow-up 3 — close the loop")],
      next: { text: "Follow-up 1 — check delivery", offset: 0 }, tags: ["trade"],
      touches: [touch("tch_003", -2, "WhatsApp", "outbound", "Sent", "First message sent by human click.")],
      valueQuoted: 3900,
    },
    {
      id: "lead_kc_004", name: "Kalahari View Lodge", kind: "guest house", town: "Upington",
      address: "River Road, Upington", url: "https://kalahariview.example.co.za", platform: "WordPress",
      verdict: "TRADING", proof: "Published availability calendar and reviewed guest photos.", source: "https://booking.example.com/kalahari-view",
      channel: "WhatsApp", stage: "Replied", sentOffset: -6,
      defects: [defect("def_007", "Rates table is a screenshot and unreadable on mobile.", "Rates")],
      contacts: [contact("con_005", "Sara Jacobs", "Owner", "+27 84 620 3311", "sara@kalahariview.example.co.za", true)],
      message: message("Readable rates for Kalahari View Lodge", "Hi Sara, your rates are currently shown as a small image on mobile. I built a clean, readable rate card with a direct booking button. Would you like the link?", "WhatsApp"),
      followups: [followup("fup_004", -4, "Follow-up 1 — check delivery", true), followup("fup_005", -1, "Follow-up 2 — share one useful tip", true), followup("fup_006", 3, "Follow-up 3 — close the loop", true)],
      reply: { text: "Thanks, please send the preview and your price.", offset: -1, channel: "WhatsApp" },
      next: { text: "Reply with demo link and quote", offset: 0 }, demoUrl: "https://demo.kgomotsoconversions.example/kalahari-view", tags: ["hospitality", "warm"],
      touches: [touch("tch_004", -6, "WhatsApp", "outbound", "Sent", "Initial outreach."), touch("tch_005", -1, "WhatsApp", "inbound", "Reply received", "Asked for preview and price.")],
      valueQuoted: 5500,
    },
    {
      id: "lead_kc_005", name: "Mogale Dental Studio", kind: "dental practice", town: "Johannesburg",
      address: "22 Beyers Naude Drive", url: "https://mogaledental.example.co.za", platform: "Squarespace",
      verdict: "TRADING", proof: "Current practitioner listings and online appointment page.", source: "https://health.example.com/mogale-dental",
      channel: "Email", stage: "Meeting", sentOffset: -10,
      defects: [defect("def_008", "Appointment CTA sits below a 4MB hero video.", "Home")],
      contacts: [contact("con_006", "Dr. Neo Mogale", "Owner", "+27 82 991 4402", "neo@mogaledental.example.co.za", true)],
      message: message("A lighter appointment page for Mogale Dental", "Hello Dr Mogale, the appointment button only appears after a large video loads on mobile. I built a lightweight page with the booking action first. Could we walk through it this week?", "Email"),
      followups: [followup("fup_007", -8, "Follow-up 1 — check delivery", true), followup("fup_008", -5, "Follow-up 2 — share one useful tip", true), followup("fup_009", -1, "Follow-up 3 — close the loop", true)],
      reply: { text: "Yes, Thursday at 15:30 works.", offset: -2, channel: "Email" },
      next: { text: "Discovery meeting — confirm scope", offset: 1 }, demoUrl: "https://demo.kgomotsoconversions.example/mogale", tags: ["meeting"],
      touches: [touch("tch_006", -10, "Email", "outbound", "Sent", "Initial outreach."), touch("tch_007", -2, "Email", "inbound", "Reply received", "Accepted a meeting.")],
      valueQuoted: 9800,
    },
    {
      id: "lead_kc_006", name: "Cape Winelands Bike Tours", kind: "tour operator", town: "Stellenbosch",
      address: "6 Market Street", url: "https://winelandsbike.example.co.za", platform: "WordPress / Elementor",
      verdict: "TRADING", proof: "Published 2026 tour dates and recent customer reviews.", source: "https://reviews.example.com/winelands-bike",
      channel: "WhatsApp", stage: "Won", sentOffset: -24,
      defects: [defect("def_009", "Booking dates are only listed in a PDF.", "Tours")],
      contacts: [contact("con_007", "Anja du Plessis", "Owner", "+27 83 771 2200", "anja@winelandsbike.example.co.za", true)],
      message: message("Turn PDF dates into bookings", "Hi Anja, I noticed your tour dates live in a PDF. I made a mobile page with selectable dates and WhatsApp checkout. Can I show you?", "WhatsApp"),
      followups: [followup("fup_010", -22, "Follow-up 1 — check delivery", true), followup("fup_011", -19, "Follow-up 2 — share one useful tip", true), followup("fup_012", -15, "Follow-up 3 — close the loop", true)],
      reply: { text: "Let's proceed with the build.", offset: -12, channel: "WhatsApp" },
      outcome: { result: "won", reason: "Deposit received for mobile booking page", value: 8500, offset: -6 },
      valueQuoted: 8500, valuePaid: 8500, paidAt: isoDate(-6),
      demoUrl: "https://demo.kgomotsoconversions.example/winelands", tags: ["won"],
      touches: [touch("tch_008", -24, "WhatsApp", "outbound", "Sent", "Initial outreach."), touch("tch_009", -12, "WhatsApp", "inbound", "Reply received", "Approved the build.")],
    },
    {
      id: "lead_kc_007", name: "Highveld Print & Copy", kind: "print shop", town: "Middelburg",
      address: "31 Church Street", url: "https://highveldprint.example.co.za", platform: "Joomla",
      verdict: "UNCERTAIN", proof: "Directory listing found; no recent public activity.", source: "https://directories.example.com/highveld-print",
      channel: "Call", stage: "Lost", sentOffset: -18,
      defects: [defect("def_010", "No opening hours visible on mobile.", "Home")],
      contacts: [contact("con_008", "Desk", "Reception", "+27 13 243 8890", "info@highveldprint.example.co.za")],
      message: message("Opening hours where customers need them", "Hello, I noticed opening hours are hard to find on mobile. I can show you a compact fix. Is the owner available?", "Call"),
      followups: [followup("fup_013", -16, "Follow-up 1 — check delivery", true), followup("fup_014", -13, "Follow-up 2 — share one useful tip", true), followup("fup_015", -9, "Follow-up 3 — close the loop", true)],
      outcome: { result: "lost", reason: "Business closed the print counter", offset: -7 }, tags: ["closed"],
      touches: [touch("tch_010", -18, "Call", "outbound", "Sent", "Spoke to reception.")],
    },
    {
      id: "lead_kc_008", name: "Boitumelo Beauty Bar", kind: "salon", town: "Mahikeng",
      address: "Shop 4, Crossing Centre", url: "https://boitumelobeauty.example.co.za", platform: "Wix",
      verdict: "TRADING", proof: "Instagram booking link and recent price list.", source: "https://social.example.com/boitumelo-beauty",
      channel: "WhatsApp", stage: "Parked", sentOffset: -13,
      defects: [defect("def_011", "Treatment menu is an unreadable image.", "Services")],
      contacts: [contact("con_009", "Boitumelo Selebogo", "Owner", "+27 81 302 6631", "hello@boitumelobeauty.example.co.za", true)],
      message: message("A readable treatment menu", "Hi Boitumelo, your treatment menu is an image that is hard to read on a phone. I can show a cleaner version. Would next month be better?", "WhatsApp"),
      followups: [followup("fup_016", -11, "Follow-up 1 — check delivery", true), followup("fup_017", -8, "Follow-up 2 — share one useful tip", true), followup("fup_018", -4, "Follow-up 3 — close the loop", true)],
      outcome: { result: "parked", reason: "Owner asked to revisit after peak season", offset: -3 }, tags: ["revisit"],
    },
    {
      id: "lead_kc_009", name: "Lekker Lane Café", kind: "café", town: "Potchefstroom",
      address: "9 Bult Street", url: "https://lekkerlane.example.co.za", platform: "Unknown",
      verdict: "UNCERTAIN", proof: "Social profile found; trading status unconfirmed.", source: "https://social.example.com/lekker-lane",
      channel: "Walk-in", stage: "Sourced",
      defects: [], contacts: [contact("con_010", "Counter", "Staff", "+27 18 293 1120", "")],
      message: null, next: undefined, tags: ["bookmark", "walk-in"],
      research: "Bookmark from a walk-in. Confirm trading status before any outreach.",
    },
    {
      id: "lead_kc_010", name: "Thabazimbi Trail Supplies", kind: "outdoor retail", town: "Thabazimbi",
      address: "Main Road", url: "https://trailsupplies.example.co.za", platform: "Shopify",
      verdict: "TRADING", proof: "Live product catalogue and recent order confirmation page.", source: "https://shop.example.com/trail-supplies",
      channel: "Email", stage: "Sourced",
      defects: [defect("def_012", "Store hours and collection address are below the footer on mobile.", "Home")],
      contacts: [contact("con_011", "Jaco Vermeulen", "Owner", "+27 84 118 9090", "jaco@trailsupplies.example.co.za", true)],
      message: message("Collection details above the fold", "Hi Jaco, your collection details sit below the footer on mobile. I drafted a lighter product page with collection details and a click-to-call action first. May I send the preview?", "Email"),
      next: { text: "Send first message in tomorrow's window", offset: 1 }, tags: ["tomorrow"],
      valueQuoted: 4200,
    },
    {
      id: "lead_kc_011", name: "Mbombela Family Law", kind: "law firm", town: "Mbombela",
      address: "12 Bester Street", url: "https://mbombelalaw.example.co.za", platform: "WordPress",
      verdict: "TRADING", proof: "Current court-roll mention and active consultation form.", source: "https://legal.example.com/mbombela-family-law",
      channel: "WhatsApp", stage: "Sent", sentOffset: -5,
      defects: [defect("def_013", "Consultation form has no mobile-friendly date picker.", "Contact")],
      contacts: [contact("con_012", "Nomsa Mahlangu", "Partner", "+27 82 660 4432", "nomsa@mbombelalaw.example.co.za", true)],
      message: message("A simpler consultation request", "Hello Nomsa, the consultation form is difficult to use on a phone. I made a short demo with one clear request step. Would you like to see it?", "WhatsApp"),
      followups: [followup("fup_019", -3, "Follow-up 1 — check delivery"), followup("fup_020", 0, "Follow-up 2 — share one useful tip"), followup("fup_021", 4, "Follow-up 3 — close the loop")],
      next: { text: "Follow-up 2 — share one useful tip", offset: 0 }, tags: ["overdue"],
      touches: [touch("tch_011", -5, "WhatsApp", "outbound", "Sent", "Initial outreach.")],
      valueQuoted: 6900,
    },
    {
      id: "lead_kc_012", name: "Old Bridge Hardware", kind: "hardware store", town: "Klerksdorp",
      address: "3 Bridge Road", url: "https://oldbridge.example.co.za", platform: "Static HTML",
      verdict: "UNCERTAIN", proof: "Historic directory listing only.", source: "https://directories.example.com/old-bridge",
      channel: "Call", stage: "Sourced", defects: [defect("def_014", "Phone number is in an image.", "Contact")],
      contacts: [contact("con_013", "Shop", "Staff", "+27 18 462 1010", "")],
      message: message("Clickable phone number", "Hello, your phone number is embedded in an image. I can show a simple clickable contact header.", "Call"),
      next: { text: "Verify trading status", offset: -4 }, tags: ["archive"], archived: true,
    },
  ];

  for (const l of leads) items.push({ type: "lead", data: lead(l) as unknown as Json });

  const library: SeedItem[] = [
    { type: "document", data: { id: "doc_brand_001", kind: "brand", title: "KgomotsoConversions voice", body: "Plain, specific, respectful. Lead with the observed mobile defect, show one useful fix, never pressure. First outreach is always a human click.", version: 3, created_at: isoAt(-30), updated_at: isoAt(-4) } },
    { type: "document", data: { id: "doc_operating_001", kind: "operating", title: "Lead desk operating rules", body: "ISO dates only. Stable IDs only. Trading needs proof and source. Sent only through mark_sent. Every reply stops nudges. No win before money lands.", version: 5, created_at: isoAt(-30), updated_at: isoAt(-2) } },
    { type: "document", data: { id: "doc_build_001", kind: "build", title: "Demo build handoff", body: "Capture mobile screenshot, list the two highest-impact defects, build one screen, attach demo URL, then wait for a human send.", version: 2, created_at: isoAt(-25), updated_at: isoAt(-7) } },
    { type: "testimonial", data: { id: "test_001", quote: "The new page made bookings obvious on a phone. We stopped losing people at the rates table.", who: "Anja du Plessis", business: "Cape Winelands Bike Tours", date: isoDate(-5), permission_given: true, created_at: isoAt(-5), updated_at: isoAt(-5) } },
    { type: "testimonial", data: { id: "test_002", quote: "Clear, quick and no jargon. The demo showed the problem before it explained the price.", who: "Sara Jacobs", business: "Kalahari View Lodge", date: isoDate(-3), permission_given: false, created_at: isoAt(-3), updated_at: isoAt(-3) } },
    { type: "win", data: { id: "win_001", lead_id: "lead_kc_006", what: "Mobile booking page deposit", amount: 8500, date: isoDate(-6), created_at: isoAt(-6), updated_at: isoAt(-6) } },
    { type: "commitment", data: { id: "com_001", task: "Review due-today queue", what: "Work overdue items oldest first and stamp every touch.", cadence: "When prompted", last_run: isoDate(-1), next_run: isoDate(0), owner: "You", created_at: isoAt(-20), updated_at: isoAt(-1) } },
    { type: "commitment", data: { id: "com_002", task: "Refresh proof on stale leads", what: "Re-check trading proof for any lead verified more than 30 days ago.", cadence: "Every 30 days", last_run: isoDate(-28), next_run: isoDate(2), owner: "Assistant", created_at: isoAt(-30), updated_at: isoAt(-28) } },
    { type: "template", data: { id: "tpl_001", name: "Observed mobile defect", channel: "WhatsApp", subject: "A quicker {kind} page for {name}", body: "Hi {contact}, I noticed {defect} on {name}'s mobile site in {town}. I built a small demo that puts the main action above the fold. Would a 2-minute preview be useful?", created_at: isoAt(-20), updated_at: isoAt(-4) } },
    { type: "template", data: { id: "tpl_002", name: "Professional services email", channel: "Email", subject: "A clearer first impression for {name}", body: "Good morning {contact}, I found {defect} while reviewing {name}'s website. I drafted a cleaner {kind} page with one reliable call to action. May I send the preview?", created_at: isoAt(-20), updated_at: isoAt(-5) } },
    { type: "saved_view", data: { id: "view_001", name: "Due this week", filter: { sort: "next_action", dueWithin: 7 }, created_at: isoAt(-15), updated_at: isoAt(-15) } },
    { type: "saved_view", data: { id: "view_002", name: "Trading & unsent", filter: { verdict: "TRADING", stage: "Sourced" }, created_at: isoAt(-15), updated_at: isoAt(-15) } },
  ];
  items.push(...library);

  const logSeeds = [
    { id: "log_seed_001", at: isoAt(-6, 9), who: "You", what: "Recorded a win: R8,500 deposit landed.", lead_id: "lead_kc_006" },
    { id: "log_seed_002", at: isoAt(-2, 12), who: "Assistant", what: "Drafted a version 2 message for Ndlovu & Partners.", lead_id: "lead_kc_002" },
    { id: "log_seed_003", at: isoAt(-1, 12), who: "You", what: "Reply received; all cadence nudges stopped.", lead_id: "lead_kc_004" },
    { id: "log_seed_004", at: isoAt(0, 8), who: "System", what: "Lead desk opened with ISO-dated records and full audit trail." },
  ];
  for (const entry of logSeeds) items.push({ type: "log", data: { ...entry, created_at: entry.at, updated_at: entry.at } });

  return items;
}
