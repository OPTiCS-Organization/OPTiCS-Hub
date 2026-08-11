import { registerAs } from "@nestjs/config"
import { MailSender } from "./mailer.constrant"

export default registerAs('mail', () => ({
    apiKey: process.env.RESEND_SMTP_API_KEY!,
    senders: {
        noreply: process.env.MAIL_FROM_NOREPLY ?? 'OPTiCS <no-reply@optics.run>',
        support: process.env.MAIL_FROM_SUPPORT ?? 'OPTiCS Support <support@optics.run>',
    } satisfies Record<MailSender, string>,

    replyTo: {
        noreply: undefined,
        support: process.env.MAIL_REPLY_TO ?? 'support@optics.run',
    } as Record<MailSender, string | undefined>,

    consoleBaseUrl: process.env.CONSOLE_BASE_URL ?? 'https://console.optics.run',

    verificationTtlMinutes: Number(process.env.MAIL_VERIFICATION_TTL_MINUTES ?? 10),

    verificationResendCooldownSeconds: Number(process.env.MAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS ?? 90),
}));