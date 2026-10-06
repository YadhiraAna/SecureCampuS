import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres.' })
  @MaxLength(80, { message: 'El nombre no puede superar 80 caracteres.' })
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'El apellido debe tener al menos 2 caracteres.' })
  @MaxLength(80, { message: 'El apellido no puede superar 80 caracteres.' })
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20, { message: 'El teléfono no puede superar 20 caracteres.' })
  @Matches(/^[0-9+\-\s()]*$/, { message: 'El teléfono solo puede contener números, espacios, +, - y paréntesis.' })
  phone?: string;
}