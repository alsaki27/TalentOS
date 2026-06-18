import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ClerkAuthGuard } from "../../common/auth/clerk-auth.guard";
import { AuthorizationService } from "../../common/auth/authorization.service";
import { CurrentUser, type CurrentUser as CurrentUserType } from "../../common/auth/current-user.decorator";
import { CreatePlanDto, UpdatePlanDto, CreateSubscriptionDto, UpdateSubscriptionDto } from "./dtos";
import { BillingService } from "./billing.service";

@ApiTags("billing")
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller("billing")
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly authz: AuthorizationService,
  ) {}

  @Get("plans")
  @ApiOperation({ summary: "List available billing plans." })
  listPlans() {
    return this.billing.listPlans();
  }

  @Get("plans/:id")
  @ApiOperation({ summary: "Get a billing plan by ID." })
  getPlan(@Param("id") id: string) {
    return this.billing.getPlan(id);
  }

  @Post("plans")
  @ApiOperation({ summary: "Create a billing plan. Admin only." })
  async createPlan(@CurrentUser() user: CurrentUserType, @Body() dto: CreatePlanDto) {
    await this.authz.requireRole(user, ["admin"]);
    return this.billing.createPlan(dto);
  }

  @Patch("plans/:id")
  @ApiOperation({ summary: "Update a billing plan. Admin only." })
  async updatePlan(@CurrentUser() user: CurrentUserType, @Param("id") id: string, @Body() dto: UpdatePlanDto) {
    await this.authz.requireRole(user, ["admin"]);
    return this.billing.updatePlan(id, dto);
  }

  @Get("subscription")
  @ApiOperation({ summary: "Get current subscription for an organization." })
  getSubscription(@Query("organizationId") organizationId: string) {
    return this.billing.getSubscriptionByOrganization(organizationId);
  }

  @Post("subscription")
  @ApiOperation({ summary: "Create a subscription." })
  createSubscription(@Body() dto: CreateSubscriptionDto) {
    return this.billing.createSubscription(dto);
  }

  @Patch("subscription")
  @ApiOperation({ summary: "Update a subscription." })
  async updateSubscription(
    @CurrentUser() user: CurrentUserType,
    @Query("organizationId") organizationId: string,
    @Body() dto: UpdateSubscriptionDto,
  ) {
    await this.authz.requireRole(user, ["admin", "manager"]);
    const sub = await this.billing.getSubscriptionByOrganization(organizationId);
    return this.billing.updateSubscription(sub.id, dto);
  }

  @Delete("subscription")
  @ApiOperation({ summary: "Cancel a subscription." })
  async cancelSubscription(
    @CurrentUser() user: CurrentUserType,
    @Query("organizationId") organizationId: string,
  ) {
    await this.authz.requireRole(user, ["admin", "manager"]);
    const sub = await this.billing.getSubscriptionByOrganization(organizationId);
    return this.billing.cancelSubscription(sub.id);
  }
}
