import { DynamicModule, Global, Module } from '@nestjs/common';
import { MailerService } from './mailer.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RESEND_CLIENT } from './mailer.constrant';
import { Resend } from 'resend';
import mailConfig from './mail.config';

@Global()
@Module({})
export class MailerModule {
  static forRootAsync(): DynamicModule {
    return {
      module: MailerModule,
      imports: [ConfigModule.forFeature(mailConfig)],
      providers: [
        {
          provide: RESEND_CLIENT,
          inject: [ConfigService],
          useFactory: (config: ConfigService) => new Resend(config.getOrThrow<string>("RESEND_SMTP_API_KEY")),
        },
        MailerService,
      ],
      exports: [MailerService],
    };
  }
}
