export function buildInviteEmailHtml(studentName: string, reportUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f8;font-family:system-ui,-apple-system,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;margin-top:32px;">
    <tr>
      <td style="background:#0F0F1A;padding:24px 32px;">
        <h1 style="color:#F0F0F5;margin:0;font-size:22px;">Kanji Buddy</h1>
      </td>
    </tr>
    <tr>
      <td style="padding:32px;">
        <h2 style="margin:0 0 16px;font-size:20px;color:#1a1a2e;">You've been invited to view learning progress</h2>
        <p style="color:#444;line-height:1.6;margin:0 0 16px;">
          <strong>${escapeHtml(studentName)}</strong> has invited you to view their Japanese learning analytics on Kanji Buddy.
        </p>
        <p style="color:#444;line-height:1.6;margin:0 0 24px;">
          You'll be able to see their progress, effort trends, accuracy breakdown, AI-assisted analysis of strengths and weaknesses, and leave notes to guide their study.
        </p>
        <table cellpadding="0" cellspacing="0" style="margin:0 auto;">
          <tr>
            <td style="background:#E84855;border-radius:8px;">
              <a href="${reportUrl}" style="display:inline-block;padding:14px 32px;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;">
                View Learning Report
              </a>
            </td>
          </tr>
        </table>
        <p style="color:#888;font-size:13px;line-height:1.5;margin:32px 0 0;border-top:1px solid #eee;padding-top:16px;">
          This link is personal to you and expires in 90 days. If you didn't expect this email, you can safely ignore it.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
