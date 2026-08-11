import { Inject, Injectable, InternalServerErrorException, Logger, OnModuleInit } from '@nestjs/common';
import { MailSender, RESEND_CLIENT } from './mailer.constrant';
import { Resend } from 'resend';
import { type ConfigType } from '@nestjs/config';
import mailConfig from './mail.config';
import { readFileSync } from 'fs';
import { join } from 'path';

@Injectable()
export class MailerService implements OnModuleInit {
    private readonly logger = new Logger(MailerService.name);

    /** 템플릿 이름 -> HTML 원문. 서버 시작 시 템플릿들을 모두 불러옴 */
    private readonly templates = new Map<string, string>();

    constructor(
        @Inject(RESEND_CLIENT) private readonly resend: Resend,
        @Inject(mailConfig.KEY) private readonly config: ConfigType<typeof mailConfig>,
    ) {}

    /**
     * 서버가 뜰 때 템플릿 파일을 전부 읽어 메모리에 캐시
     * 메일 보낼 때마다 디스크를 읽지 않고, 파일이 없으면 서버 부팅 시 오류가 발생함.
     */
    onModuleInit() {
        // 읽어올 템플릿 목록. 파일을 추가하면 여기에도 그 파일의 이름을 추가해야 함.
        for (const name of ['verification', 'verificationForExisting']) {
            // 경로 기준은 실행 위치(process.cwd())가 아니라 이 파일 위치(__dirname).
            // .html은 nestjs 컴파일러의 컴파일 대상이 아니라서 nest-cli.json의 assets 설정으로 dist에 복사하도록 해야 함.
            this.templates.set(name, readFileSync(join(__dirname, 'templates', `${name}.html`), 'utf-8'));
        }
    }

    /** 캐시된 템플릿의 {{변수}} 자리를 vars 값으로 채워 완성된 HTML을 만듦 */
    private render(name: string, vars: Record<string, string>) {
        const template = this.templates.get(name);
        if (!template) throw new Error(`Unknown mail template: ${name}`);

        // {{변수}}를 찾아서 vars에 같은 이름으로 등록된 key의 value로 치환하는 정규식
        // vars에 없는 변수는 ''로 비워서 {{variable}} 변수 태그가 본문에 노출되는 걸 방지
        // 값은 escapeHtml로 감싼다 -> 사용자 입력이 태그로 해석되는 HTML 인젝션 방지
        return template.replace(/\{\{(\w+)\}\}/g, (_, key:string) => escapeHtml(vars[key] ?? ''))
    }

    /**
     * 발송을 담당하는 공통 메서드입니다.
     * 외부에는 sendVerification 같은 용도별 메서드만 노출합니다.
     * @param sender 발신 부서(noreply/support). 이 값으로 From 주소와 Reply-To가 결정된다.
     * @param text HTML을 못 읽는 클라이언트용 대체 본문. 없으면 스팸 점수가 올라간다.
     */
    private async send(sender: MailSender, to: string[] | string, subject: string, html: string, text?: string) {
        const {data, error} = await this.resend.emails.send({
            // 부서별 주소는 mail.config.ts에서 정의됨. 호출부는 'noreply'만 넘기면 된다.
            from: this.config.senders[sender],
            // noreply는 undefined로 정의되어 있기 때문에 replyTo 헤더는 알아서 무시됨.
            replyTo: this.config.replyTo[sender],
            to: to,
            subject: subject,
            html: html,
            text: text,
        });

        // Resend SDK는 발송에 실패해도 예외를 던지지 않고 error 객체를 반환함.
        if (error) {
            this.logger.error(`[${sender}] Failed to send mail: ${error.name}`, error.message);
            throw new InternalServerErrorException('Failed to send mail');
        }

        // { id: string } 형태. Resend가 요청을 접수했다는 뜻이며, 수신함 도착 보장은 아님.
        return data;
    }

    /**
     * 회원가입 이메일 인증 메일을 보냅니다.
     * @param verificationCode verification 테이블에 저장된 인증 코드. URL 쿼리로 전달된다.
     * @param requestedAt 코드가 발급된 시각. 만료가 이 시각 기준이라 재전송 시에도 최초 발급 시각을 넘겨야 한다.
     */
    async sendVerification(to: string, verificationCode: string, requestedAt: Date) {
        const { consoleBaseUrl, verificationTtlMinutes } = this.config;

        // 코드는 쿼리스트링에 들어가므로 URL 인코딩
        const verificationUrl = `${consoleBaseUrl}/auth?verify=${encodeURIComponent(verificationCode)}`;

        const html = this.render('verification', {
            verificationUrl,
            expiresInMinutes: String(verificationTtlMinutes),
            email: to,
            requestedAt: formatKst(requestedAt),
            year: String(new Date().getFullYear()),
        });

        const text = [
            '이메일 주소 인증',
            '',
            '아래 주소로 접속해 남은 회원가입 단계를 완료해 주세요.',
            verificationUrl,
            '',
            `인증 대상: ${to}`,
            `요청 시각: ${formatKst(requestedAt)}`,
            `이 링크는 요청 시각 기준 ${verificationTtlMinutes}분간 유효합니다.`,
            '본인이 요청한 것이 아니라면 이 메일을 무시하셔도 됩니다.',
        ].join('\n');

        return this.send(MailSender.NOREPLY, to, '[OPTiCS] 이메일 주소 인증', html, text);
    }

    /**
     * 이메일 인증 도입 이전에 가입한 기존 사용자에게 인증을 요청하는 메일입니다.
     *
     * 신규 가입용 링크와 쿼리 파라미터를 다르게 씁니다(verify-existing).
     * 콘솔이 "가입 폼을 띄울지" "로그인된 계정을 인증 처리할지" 구분해야 하기 때문입니다.
     */
    async sendVerificationForExisting(to: string, verificationCode: string, requestedAt: Date) {
        const { consoleBaseUrl, verificationTtlMinutes } = this.config;

        const verificationUrl = `${consoleBaseUrl}/auth?verify-existing=${encodeURIComponent(verificationCode)}`;

        const html = this.render('verificationForExisting', {
            verificationUrl,
            expiresInMinutes: String(verificationTtlMinutes),
            email: to,
            requestedAt: formatKst(requestedAt),
            year: String(new Date().getFullYear()),
        });

        const text = [
            '이메일 인증이 필요합니다',
            '',
            '이메일 인증 절차가 새로 도입되었습니다. 아래 주소로 접속해 인증을 마쳐 주세요.',
            verificationUrl,
            '',
            `인증 대상: ${to}`,
            `요청 시각: ${formatKst(requestedAt)}`,
            `이 링크는 요청 시각 기준 ${verificationTtlMinutes}분간 유효합니다.`,
            '인증을 마치기 전까지 계정과 기존 데이터는 그대로 유지됩니다.',
        ].join('\n');

        return this.send(MailSender.NOREPLY, to, '[OPTiCS] 이메일 인증이 필요합니다', html, text);
    }
}

/** 메일에 표시할 요청 시각. 컨테이너 타임존(보통 UTC)에 휘둘리지 않도록 KST를 명시한다. */
function formatKst(date: Date) {
    const formatted = new Intl.DateTimeFormat('ko-KR', {
        dateStyle: 'long',
        timeStyle: 'short',
        timeZone: 'Asia/Seoul',
    }).format(date);

    return `${formatted} (KST)`;
}

const HTML_ESCAPES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
};

/**
 * 템플릿에 치환할 값에서 태그로 해석될 문자를 안전한 문자로 변경함
 */
function escapeHtml(value: string) {
    return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}