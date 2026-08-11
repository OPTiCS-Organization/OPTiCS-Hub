import { IsAscii, IsNotEmpty, IsString } from "class-validator";

export class IsValidVerificationCodeDTO {
    @IsNotEmpty()
    @IsString()
    @IsAscii()
    verificationCode: string;
}