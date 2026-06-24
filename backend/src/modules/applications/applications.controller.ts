import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ClerkAuthGuard } from "../../common/auth/clerk-auth.guard";
import { CurrentUser, type CurrentUser as CurrentUserType } from "../../common/auth/current-user.decorator";
import { ApplicationsService } from "./applications.service";
import { CreateApplicationCommentDto, CreateApplicationDto, UpdateApplicationDto } from "./dtos";

@ApiTags("applications")
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller("applications")
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Get()
  @ApiOperation({ summary: "List applications/tickets. Application engineers are scoped to assigned items." })
  list(@CurrentUser() user: CurrentUserType, @Query("status") status?: string, @Query("assignedToMe") assignedToMe?: string, @Query("page") page?: string, @Query("pageSize") pageSize?: string) {
    return this.applications.list(user, { status, assignedToMe: assignedToMe === "true", page: Number(page) || 1, pageSize: Number(pageSize) || 50 });
  }

  @Get(":id")
  @ApiOperation({ summary: "Get application/ticket timeline." })
  get(@CurrentUser() user: CurrentUserType, @Param("id") id: string) {
    return this.applications.get(user, id);
  }

  @Post()
  @ApiOperation({ summary: "Create application or assignment ticket." })
  create(@CurrentUser() user: CurrentUserType, @Body() dto: CreateApplicationDto) {
    return this.applications.create(user, dto);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update application status, assignment, review, or follow-up." })
  update(@CurrentUser() user: CurrentUserType, @Param("id") id: string, @Body() dto: UpdateApplicationDto) {
    return this.applications.update(user, id, dto);
  }

  @Post(":id/comments")
  @ApiOperation({ summary: "Add application comment/activity log." })
  addComment(@CurrentUser() user: CurrentUserType, @Param("id") id: string, @Body() dto: CreateApplicationCommentDto) {
    return this.applications.addComment(user, id, dto);
  }
}
