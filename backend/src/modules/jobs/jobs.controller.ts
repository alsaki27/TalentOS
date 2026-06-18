import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ClerkAuthGuard } from "../../common/auth/clerk-auth.guard";
import { CurrentUser, type CurrentUser as CurrentUserType } from "../../common/auth/current-user.decorator";
import { CreateJobDto, UpdateJobDto } from "./dtos";
import { JobsService } from "./jobs.service";

@ApiTags("jobs")
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller("jobs")
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  @ApiOperation({ summary: "List jobs with filters." })
  list(@Query("search") search?: string, @Query("source") source?: string, @Query("category") category?: string, @Query("page") page?: string, @Query("pageSize") pageSize?: string) {
    return this.jobs.list({ search, source, category, page: Number(page) || 1, pageSize: Number(pageSize) || 50 });
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a job with applicants, comments, and company." })
  get(@Param("id") id: string) {
    return this.jobs.get(id);
  }

  @Post()
  @ApiOperation({ summary: "Create job. Admin/manager/recruiter." })
  create(@CurrentUser() user: CurrentUserType, @Body() dto: CreateJobDto) {
    return this.jobs.create(user, dto);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update job. Admin/manager/recruiter." })
  update(@CurrentUser() user: CurrentUserType, @Param("id") id: string, @Body() dto: UpdateJobDto) {
    return this.jobs.update(user, id, dto);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Soft-delete job. Admin/manager." })
  delete(@CurrentUser() user: CurrentUserType, @Param("id") id: string) {
    return this.jobs.delete(user, id);
  }
}
