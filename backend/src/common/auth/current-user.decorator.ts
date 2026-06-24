import { createParamDecorator, ExecutionContext } from "@nestjs/common";

export interface CurrentUser {
  clerkUserId: string;
  profileId?: string;
  email?: string | null;
  role?: string;
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): CurrentUser => {
  const request = ctx.switchToHttp().getRequest<{ user: CurrentUser }>();
  return request.user;
});
