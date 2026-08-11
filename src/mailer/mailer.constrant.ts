export const RESEND_CLIENT = Symbol('RESEND_CLIENT');

export const MailSender = {
    NOREPLY: 'noreply',
    SUPPORT: 'support',
} as const;
export type MailSender = (typeof MailSender)[keyof typeof MailSender];