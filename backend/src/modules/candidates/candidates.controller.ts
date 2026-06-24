import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ClerkAuthGuard } from "../../common/auth/clerk-auth.guard";
import { CurrentUser, type CurrentUser as CurrentUserType } from "../../common/auth/current-user.decorator";
import { CandidatesService } from "./candidates.service";
import { CreateCandidateDto, UpdateCandidateDto } from "./dtos";

@ApiTags("candidates")
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller("candidates")
export class CandidatesController {
  constructor(private readonly candidates: CandidatesService) {}

  @Get()
  @ApiOperation({ summary: "List candidates." })
  list(@Query("search") search?: string, @Query("status") status?: string, @Query("page") page?: string, @Query("pageSize") pageSize?: string) {
    return this.candidates.list({ search, status, page: Number(page) || 1, pageSize: Number(pageSize) || 50 });
  }

  @Get(":id")
  @ApiOperation({ summary: "Get candidate profile with resumes and applications." })
  get(@Param("id") id: string) {
    return this.candidates.get(id);
  }

  @Post()
  @ApiOperation({ summary: "Create candidate. Admin/manager/recruiter." })
  create(@CurrentUser() user: CurrentUserType, @Body() dto: CreateCandidateDto) {
    return this.candidates.create(user, dto);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update candidate. Admin/manager/recruiter." })
  update(@CurrentUser() user: CurrentUserType, @Param("id") id: string, @Body() dto: UpdateCandidateDto) {
    return this.candidates.update(user, id, dto);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Soft-delete candidate. Admin/manager." })
  delete(@CurrentUser() user: CurrentUserType, @Param("id") id: string) {
    return this.candidates.delete(user, id);
  }
}
