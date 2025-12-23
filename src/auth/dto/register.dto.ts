import { IsEmail, IsNotEmpty, IsString, Length } from "class-validator";

export class RegisterDTO {
  @IsNotEmpty()
  @IsEmail()
  email: string;
  
  @IsNotEmpty()
  @IsString()
  @Length(8, 255)
  password: string;
  
  @IsNotEmpty()
  @IsString()
  display: string;
}