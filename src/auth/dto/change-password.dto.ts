import { IsNotEmpty, IsString, Length } from 'class-validator';

export class ChangePasswordDTO {
  @IsNotEmpty()
  @IsString()
  currentPassword: string;

  @IsNotEmpty()
  @IsString()
  @Length(8, 255)
  newPassword: string;

  @IsNotEmpty()
  @IsString()
  @Length(8, 255)
  newPasswordConfirm: string;
}
