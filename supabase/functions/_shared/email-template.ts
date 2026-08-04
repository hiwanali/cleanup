export type EmailDetail = {
  label: string;
  value: string;
};

export type CleanUpEmailInput = {
  subject: string;
  preheader: string;
  eyebrow?: string;
  title: string;
  greeting?: string;
  intro: string;
  body?: string[];
  details?: EmailDetail[];
  ctaLabel?: string;
  ctaUrl?: string;
  note?: string;
  footerNote?: string;
};

export function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatDateTimeSE(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("sv-SE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Stockholm",
  });
}

export function serviceLabel(serviceType: string | null | undefined): string {
  switch (serviceType) {
    case "standard_cleaning":
      return "Hemstädning";
    case "deep_cleaning":
      return "Storstädning";
    case "moving_cleaning":
      return "Flyttstädning";
    case "window_cleaning":
      return "Fönsterputs";
    case "office_cleaning":
      return "Kontorsstädning";
    case "stair_cleaning":
      return "Trappstädning";
    case "construction_cleaning":
      return "Byggstädning";
    case "construction_services":
      return "Byggtjänster";
    default:
      return "Städning";
  }
}

function detailRows(details: EmailDetail[] = []): string {
  return details
    .filter((detail) => detail.value)
    .map((detail) => `
      <tr>
        <td style="padding-top:10px;padding-bottom:10px;border-bottom:1px solid #e6edf5;">
          <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#64748b;">${escapeHtml(detail.label)}</p>
          <p style="margin:2px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:22px;color:#0f172a;font-weight:700;">${escapeHtml(detail.value)}</p>
        </td>
      </tr>
    `)
    .join("");
}

function textFrom(input: CleanUpEmailInput): string {
  const lines = [
    input.title,
    "",
    input.greeting,
    input.intro,
    ...(input.body ?? []),
    "",
    ...(input.details?.length ? input.details.filter((d) => d.value).map((d) => `${d.label}: ${d.value}`) : []),
    input.ctaUrl ? `\n${input.ctaLabel ?? "Öppna"}: ${input.ctaUrl}` : "",
    input.note ? `\n${input.note}` : "",
    "",
    input.footerNote ?? "Vänliga hälsningar\nCleanUp",
  ];

  return lines.filter((line) => line !== undefined && line !== null && String(line).trim() !== "").join("\n");
}

export function renderCleanUpEmail(input: CleanUpEmailInput): { subject: string; text: string; html: string } {
  const body = (input.body ?? [])
    .filter(Boolean)
    .map((paragraph) => `
      <p style="margin:14px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#334155;">
        ${escapeHtml(paragraph)}
      </p>
    `)
    .join("");

  const details = input.details?.length
    ? `
      <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-top:22px;border-top:1px solid #e6edf5;">
        ${detailRows(input.details)}
      </table>
    `
    : "";

  const cta = input.ctaUrl
    ? `
      <table cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-top:26px;">
        <tr>
          <td bgcolor="#0f766e" style="border-radius:6px;">
            <a href="${escapeHtml(input.ctaUrl)}" style="display:inline-block;padding-top:13px;padding-right:18px;padding-bottom:13px;padding-left:18px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:20px;color:#ffffff;text-decoration:none;font-weight:700;">
              ${escapeHtml(input.ctaLabel ?? "Öppna")}
            </a>
          </td>
        </tr>
      </table>
    `
    : "";

  const note = input.note
    ? `
      <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-top:22px;">
        <tr>
          <td bgcolor="#f8fafc" style="border:1px solid #e2e8f0;border-radius:6px;padding-top:12px;padding-right:14px;padding-bottom:12px;padding-left:14px;">
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:#475569;">${escapeHtml(input.note)}</p>
          </td>
        </tr>
      </table>
    `
    : "";

  const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <title>${escapeHtml(input.subject)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f4f7fb;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      ${escapeHtml(input.preheader)}
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" bgcolor="#f4f7fb" style="background-color:#f4f7fb;">
      <tr>
        <td align="center" style="padding-top:28px;padding-right:14px;padding-bottom:28px;padding-left:14px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="max-width:640px;background-color:#ffffff;border:1px solid #dbe5f0;border-radius:8px;overflow:hidden;">
            <tr>
              <td bgcolor="#0f172a" style="padding-top:22px;padding-right:24px;padding-bottom:22px;padding-left:24px;background-color:#0f172a;">
                <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">
                  <tr>
                    <td style="vertical-align:middle;">
                      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:24px;color:#ffffff;font-weight:700;">CleanUp</p>
                      <p style="margin:2px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#a7f3d0;">Städning, schema och kundportal</p>
                    </td>
                    <td align="right" style="vertical-align:middle;">
                      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#cbd5e1;">${escapeHtml(input.eyebrow ?? "Meddelande")}</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding-top:28px;padding-right:26px;padding-bottom:28px;padding-left:26px;">
                <h1 style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:31px;color:#0f172a;font-weight:700;">${escapeHtml(input.title)}</h1>
                ${input.greeting ? `<p style="margin:18px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#334155;">${escapeHtml(input.greeting)}</p>` : ""}
                <p style="margin:14px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#334155;">${escapeHtml(input.intro)}</p>
                ${body}
                ${details}
                ${cta}
                ${note}
              </td>
            </tr>
            <tr>
              <td bgcolor="#f8fafc" style="padding-top:18px;padding-right:26px;padding-bottom:18px;padding-left:26px;border-top:1px solid #e2e8f0;background-color:#f8fafc;">
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:19px;color:#64748b;">
                  ${escapeHtml(input.footerNote ?? "Vänliga hälsningar, CleanUp")}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return {
    subject: input.subject,
    text: textFrom(input),
    html,
  };
}
