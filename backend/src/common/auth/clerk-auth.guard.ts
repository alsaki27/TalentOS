import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { verifyToken } from "@clerk/backend";

@Injectable()
export class ClerkAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const header = String(request.headers.authorization ?? "");
    const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
    if (!token) throw new UnauthorizedException("Clerk bearer token required.");

    const payload = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
    }).catch(() => null);

    if (!payload?.sub) throw new UnauthorizedException("Invalid Clerk token.");
    request.user = {
      clerkUserId: payload.sub,
      email: typeof payload.email === "string" ? payload.email : null,
    };
    return true;
  }
}
