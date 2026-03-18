import { IsEmail, IsNotEmpty } from 'class-validator';

export class CheckEmailDTO {
  @IsNotEmpty()
  @IsEmail()
  email: string;
}
