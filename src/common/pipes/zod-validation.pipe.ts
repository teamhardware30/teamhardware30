import { ArgumentMetadata, HttpException, HttpStatus, PipeTransform } from '@nestjs/common';
import { ZodError, ZodSchema } from 'zod';

export class ZodValidationException extends HttpException {
  constructor(public readonly fieldErrors: Record<string, string>) {
    super({ message: 'Validation failed', fieldErrors }, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata) {
    const result = this.schema.safeParse(value);
    if (result.success) {
      return result.data;
    }
    throw new ZodValidationException(flattenZodError(result.error));
  }
}

function flattenZodError(error: ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_root';
    if (!fieldErrors[key]) {
      fieldErrors[key] = issue.message;
    }
  }
  return fieldErrors;
}
