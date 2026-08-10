import { Inject, Injectable } from '@nestjs/common';
import { RESEND_CLIENT } from './mailer.constrant';
import { Resend } from 'resend';
import { ConfigService, type ConfigType } from '@nestjs/config';
import mailConfig from './mail.config';

@Injectable()
export class MailerService {
    private readonly from: string;

    constructor(
        @Inject(RESEND_CLIENT) private readonly resend: Resend,
        @Inject(mailConfig.KEY)
        config: ConfigType<typeof mailConfig>,
        private readonly configService: ConfigService,
    ) {
        this.from = configService.getOrThrow<string>('SMTP_MAIL_FROM');
    }

    async sendTo(to: string) {
        const {data, error} = await this.resend.emails.send({
            from: this.from,
            to,
            subject:"Test",
            html: "afaf"
        })
    }

    // private async sendVerification(to: string, email: string, verificationCode: string) {

    // }
}
