import { IsAscii, IsEmail, IsNotEmpty, IsString, Length } from "class-validator";

export class RegisterDTO {
  @IsNotEmpty()
  @IsString()
  @IsAscii()
  verificationCode: string

  @IsNotEmpty()
  @IsString()
  @Length(8, 255)
  password: string;

  @IsNotEmpty()
  @IsString()
  @Length(8, 255)
  passwordConfirm: string;

  @IsNotEmpty()
  @IsString()
  display: string;
}