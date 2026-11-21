export type MailEnv = { BREVO_API_KEY: string; SENDER_EMAIL: string; SENDER_NAME: string };
// Text only. Never attach media. Never log the body (it can contain codes/links).
export async function sendMail(env: MailEnv, to: string, subject: string, text: string) {
  const r = await fetch("https://api.brevo.com/v3/smtp/email", { method: "POST", headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ sender: { name: env.SENDER_NAME, email: env.SENDER_EMAIL }, to: [{ email: to }], subject, textContent: text }) });
  if (!r.ok) throw new Error("mail_" + r.status);
}
