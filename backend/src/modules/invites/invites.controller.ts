import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ClerkAuthGuard } from "../../common/auth/clerk-auth.guard";
import { AuthorizationService } from "../../common/auth/authorization.service";
import { CurrentUser, type CurrentUser as CurrentUserType } from "../../common/auth/current-user.decorator";
import { CreateInviteDto, AcceptInviteDto } from "./dtos";
import { InvitesService } from "./invites.service";

@ApiTags("invites")
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller("invites")
export class InvitesController {
  constructor(
    private readonly invites: InvitesService,
    private readonly authz: AuthorizationService,
  ) {}

  @Post()
  @ApiOperation({ summary: "Create a team invite." })
  async create(@CurrentUser() user: CurrentUserType, @Body() dto: CreateInviteDto) {
    await this.authz.requireRole(user, ["admin", "manager"]);
    return this.invites.createInvite(dto);
  }

  @Get()
  @ApiOperation({ summary: "List invites." })
  async list(@CurrentUser() user: CurrentUserType) {
    await this.authz.requireRole(user, ["admin", "manager"]);
    return this.invites.listInvites();
  }

  @Patch(":id/revoke")
  @ApiOperation({ summary: "Revoke an invite." })
  async revoke(@CurrentUser() user: CurrentUserType, @Param("id") id: string) {
    await this.authz.requireRole(user, ["admin", "manager"]);
    return this.invites.revokeInvite(id);
  }

  @Post("accept")
  @ApiOperation({ summary: "Accept an invite by token." })
  accept(@Body() dto: AcceptInviteDto) {
    return this.invites.acceptInvite(dto);
  }

  @Post(":id/resend")
  @ApiOperation({ summary: "Resend an invite." })
  async resend(@CurrentUser() user: CurrentUserType, @Param("id") id: string) {
    await this.authz.requireRole(user, ["admin", "manager"]);
    return this.invites.resendInvite(id);
  }
}
