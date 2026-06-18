import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ClerkAuthGuard } from "../../common/auth/clerk-auth.guard";
import { AuthorizationService } from "../../common/auth/authorization.service";
import { CurrentUser, type CurrentUser as CurrentUserType } from "../../common/auth/current-user.decorator";
import { CreateOrganizationDto, UpdateOrganizationDto } from "./dtos";
import { OrganizationsService } from "./organizations.service";

@ApiTags("organizations")
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller("organizations")
export class OrganizationsController {
  constructor(
    private readonly organizations: OrganizationsService,
    private readonly authz: AuthorizationService,
  ) {}

  @Post()
  @ApiOperation({ summary: "Create an organization." })
  async create(@CurrentUser() user: CurrentUserType, @Body() dto: CreateOrganizationDto) {
    await this.authz.requireRole(user, ["admin", "manager"]);
    return this.organizations.create(dto);
  }

  @Get()
  @ApiOperation({ summary: "List organizations." })
  list() {
    return this.organizations.list();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get an organization by ID." })
  get(@Param("id") id: string) {
    return this.organizations.get(id);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update an organization." })
  async update(@CurrentUser() user: CurrentUserType, @Param("id") id: string, @Body() dto: UpdateOrganizationDto) {
    await this.authz.requireRole(user, ["admin", "manager"]);
    return this.organizations.update(id, dto);
  }

  @Get(":id/members")
  @ApiOperation({ summary: "Get organization members." })
  getMembers(@Param("id") id: string) {
    return this.organizations.getMembers(id);
  }

  @Get(":id/subscription")
  @ApiOperation({ summary: "Get organization subscription." })
  getSubscription(@Param("id") id: string) {
    return this.organizations.getSubscription(id);
  }
}
