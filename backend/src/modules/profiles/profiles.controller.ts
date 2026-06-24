import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ClerkAuthGuard } from "../../common/auth/clerk-auth.guard";
import { AuthorizationService } from "../../common/auth/authorization.service";
import { CurrentUser, type CurrentUser as CurrentUserType } from "../../common/auth/current-user.decorator";
import { CreateProfileDto, UpdateProfileDto } from "./dtos";
import { ProfilesService } from "./profiles.service";

@ApiTags("profiles")
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller("profiles")
export class ProfilesController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly authz: AuthorizationService,
  ) {}

  @Get()
  @ApiOperation({ summary: "List team profiles. Admin/manager only." })
  async list(@CurrentUser() user: CurrentUserType) {
    await this.authz.requireRole(user, ["admin", "manager"]);
    return this.profiles.list();
  }

  @Post()
  @ApiOperation({ summary: "Create a profile linked to a Clerk user. Admin only." })
  async create(@CurrentUser() user: CurrentUserType, @Body() dto: CreateProfileDto) {
    await this.authz.requireRole(user, ["admin"]);
    return this.profiles.create(dto);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a team profile. Admin only." })
  async update(@CurrentUser() user: CurrentUserType, @Param("id") id: string, @Body() dto: UpdateProfileDto) {
    await this.authz.requireRole(user, ["admin"]);
    return this.profiles.update(id, dto);
  }
}
