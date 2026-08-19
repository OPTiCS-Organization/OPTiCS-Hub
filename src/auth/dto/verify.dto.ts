import { IsEmail, IsNotEmpty } from "class-validator";

export class VerifyEmailDTO {
  @IsNotEmpty()
  @IsEmail()
  email: string;
}