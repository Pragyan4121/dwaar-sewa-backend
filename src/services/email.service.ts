import { Resend } from "resend";

export type EmailOtpPurpose = "provider_registration" | "forgot_password";

interface SendOtpEmailInput {
  to: string;
  otp: string;
  purpose: EmailOtpPurpose;
  recipientName?: string | null;
}

function getResendClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    throw new Error("RESEND_API_KEY_NOT_CONFIGURED");
  }

  return new Resend(apiKey);
}

function getSenderEmail(): string {
  const senderEmail = process.env.RESEND_FROM_EMAIL;

  if (!senderEmail) {
    throw new Error("RESEND_FROM_EMAIL_NOT_CONFIGURED");
  }

  return senderEmail;
}

function getOtpEmailContent(
  purpose: EmailOtpPurpose,
  recipientName?: string | null,
) {
  const greeting = recipientName?.trim()
    ? `Hello ${recipientName.trim()},`
    : "Hello,";

  if (purpose === "forgot_password") {
    return {
      subject: "Reset your Dwaar Sewa provider password",
      title: "Password reset verification",
      greeting,
      description:
        "Use the verification code below to reset your Dwaar Sewa provider account password.",
    };
  }

  return {
    subject: "Verify your Dwaar Sewa provider email",
    title: "Provider email verification",
    greeting,
    description:
      "Use the verification code below to verify your provider account email.",
  };
}

export async function sendOtpEmail({
  to,
  otp,
  purpose,
  recipientName,
}: SendOtpEmailInput): Promise<void> {
  const normalizedEmail = to.trim().toLowerCase();

  if (!normalizedEmail) {
    throw new Error("RECIPIENT_EMAIL_REQUIRED");
  }

  const resend = getResendClient();
  const from = getSenderEmail();

  const content = getOtpEmailContent(purpose, recipientName);

  const expiryMinutes = Number(process.env.OTP_EXPIRY_MINUTES ?? "10");

  const safeExpiryMinutes =
    Number.isInteger(expiryMinutes) && expiryMinutes > 0 ? expiryMinutes : 10;

  const result = await resend.emails.send({
    from,
    to: normalizedEmail,
    subject: content.subject,

    text: [
      content.greeting,
      "",
      content.description,
      "",
      `Verification code: ${otp}`,
      "",
      `This code expires in ${safeExpiryMinutes} minutes.`,
      "",
      "If you did not request this code, you can safely ignore this email.",
      "",
      "Dwaar Sewa",
    ].join("\n"),

    html: `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1.0"
          />
          <title>${content.title}</title>
        </head>

        <body
          style="
            margin: 0;
            padding: 0;
            background-color: #f4f6f8;
            font-family: Arial, Helvetica, sans-serif;
            color: #1f2937;
          "
        >
          <table
            role="presentation"
            width="100%"
            cellspacing="0"
            cellpadding="0"
            style="background-color: #f4f6f8; padding: 32px 16px;"
          >
            <tr>
              <td align="center">
                <table
                  role="presentation"
                  width="100%"
                  cellspacing="0"
                  cellpadding="0"
                  style="
                    max-width: 560px;
                    background-color: #ffffff;
                    border-radius: 12px;
                    overflow: hidden;
                    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
                  "
                >
                  <tr>
                    <td
                      style="
                        background-color: #1f7a4d;
                        padding: 24px;
                        text-align: center;
                      "
                    >
                      <h1
                        style="
                          margin: 0;
                          font-size: 24px;
                          color: #ffffff;
                        "
                      >
                        Dwaar Sewa
                      </h1>

                      <p
                        style="
                          margin: 8px 0 0;
                          color: #dff3e8;
                          font-size: 14px;
                        "
                      >
                        Reliable Home Services at Your Doorstep
                      </p>
                    </td>
                  </tr>

                  <tr>
                    <td style="padding: 32px;">
                      <h2
                        style="
                          margin: 0 0 20px;
                          font-size: 22px;
                          color: #111827;
                        "
                      >
                        ${content.title}
                      </h2>

                      <p
                        style="
                          margin: 0 0 16px;
                          line-height: 1.6;
                          font-size: 16px;
                        "
                      >
                        ${content.greeting}
                      </p>

                      <p
                        style="
                          margin: 0 0 24px;
                          line-height: 1.6;
                          font-size: 16px;
                        "
                      >
                        ${content.description}
                      </p>

                      <div
                        style="
                          margin: 24px 0;
                          padding: 20px;
                          background-color: #f0fdf4;
                          border: 1px solid #bbf7d0;
                          border-radius: 10px;
                          text-align: center;
                        "
                      >
                        <div
                          style="
                            margin-bottom: 8px;
                            font-size: 13px;
                            color: #4b5563;
                            text-transform: uppercase;
                            letter-spacing: 1px;
                          "
                        >
                          Verification Code
                        </div>

                        <div
                          style="
                            font-size: 34px;
                            font-weight: bold;
                            letter-spacing: 8px;
                            color: #166534;
                          "
                        >
                          ${otp}
                        </div>
                      </div>

                      <p
                        style="
                          margin: 0 0 16px;
                          line-height: 1.6;
                          font-size: 14px;
                          color: #4b5563;
                        "
                      >
                        This code expires in
                        <strong>${safeExpiryMinutes} minutes</strong>.
                      </p>

                      <p
                        style="
                          margin: 0;
                          line-height: 1.6;
                          font-size: 14px;
                          color: #6b7280;
                        "
                      >
                        If you did not request this code, you can safely
                        ignore this email.
                      </p>
                    </td>
                  </tr>

                  <tr>
                    <td
                      style="
                        padding: 20px 32px;
                        background-color: #f9fafb;
                        text-align: center;
                        font-size: 12px;
                        color: #6b7280;
                      "
                    >
                      © ${new Date().getFullYear()} Dwaar Sewa.
                      All rights reserved.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `,
  });

  if (result.error) {
    console.error("Resend email error:", result.error);
    throw new Error("OTP_EMAIL_SEND_FAILED");
  }
}
