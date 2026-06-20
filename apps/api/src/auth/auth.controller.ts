import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { AuthResult, AuthUser } from '@oms/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import type { JwtConfig } from '../config/configuration';
import { AuthService, type RequestMeta } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { PinLoginDto } from './dto/pin-login.dto';
import { SetPinDto } from './dto/set-pin.dto';

/** Tighter rate limit for credential endpoints (brute-force protection). */
const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  private readonly cookieName: string;
  private readonly isProduction: boolean;

  constructor(
    private readonly auth: AuthService,
    config: ConfigService,
  ) {
    this.cookieName = config.get<JwtConfig>('jwt')!.refreshCookieName;
    this.isProduction = config.get<boolean>('isProduction') ?? false;
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Authenticate with email + password (+ refresh cookie).' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResult> {
    const session = await this.auth.login(dto.email, dto.password, this.meta(req));
    this.setRefreshCookie(res, session.refreshToken, session.refreshExpiresAt);
    return session.auth;
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('pin-login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Quick login with email + numeric PIN (+ refresh cookie).' })
  async pinLogin(
    @Body() dto: PinLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResult> {
    const session = await this.auth.loginWithPin(dto.email, dto.pin, this.meta(req));
    this.setRefreshCookie(res, session.refreshToken, session.refreshExpiresAt);
    return session.auth;
  }

  @Post('pin')
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiOperation({ summary: 'Set or replace the current user’s quick-login PIN.' })
  async setPin(@CurrentUser('id') userId: string, @Body() dto: SetPinDto): Promise<{ ok: true }> {
    await this.auth.setPin(userId, dto.pin);
    return { ok: true };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Exchange the refresh cookie for a new access token (rotates refresh).' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResult> {
    const raw = req.cookies?.[this.cookieName];
    const session = await this.auth.refresh(raw, this.meta(req));
    this.setRefreshCookie(res, session.refreshToken, session.refreshExpiresAt);
    return session.auth;
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke the refresh token and clear the cookie.' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ ok: true }> {
    const raw = req.cookies?.[this.cookieName];
    await this.auth.logout(raw, this.meta(req));
    res.clearCookie(this.cookieName, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Return the current user with roles and flattened permissions.' })
  me(@CurrentUser() user: AuthenticatedUser): Promise<AuthUser> {
    return this.auth.currentUser(user.id);
  }

  @Post('change-password')
  @ApiBearerAuth()
  @HttpCode(200)
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ ok: true }> {
    await this.auth.changePassword(userId, dto.currentPassword, dto.newPassword);
    return { ok: true };
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private meta(req: Request): RequestMeta {
    const fwd = req.headers['x-forwarded-for'];
    const ip =
      (typeof fwd === 'string' && fwd.split(',')[0].trim()) ||
      req.ip ||
      req.socket?.remoteAddress ||
      null;
    return { ip, userAgent: req.headers['user-agent'] ?? null };
  }

  private setRefreshCookie(res: Response, token: string, expires: Date): void {
    res.cookie(this.cookieName, token, {
      httpOnly: true,
      secure: this.isProduction,
      sameSite: this.isProduction ? 'none' : 'lax',
      expires,
      path: '/',
    });
  }
}
