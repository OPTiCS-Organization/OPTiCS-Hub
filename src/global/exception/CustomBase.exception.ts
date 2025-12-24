import { HttpException, HttpStatus } from '@nestjs/common';

export class CustomHttpException extends HttpException {
  constructor(
    message: string,
    status: number = HttpStatus.BAD_REQUEST,
  ) {
    super(message, status);
  }
}