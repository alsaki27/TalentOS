import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ClerkAuthGuard } from "../../common/auth/clerk-auth.guard";
import { CurrentUser, type CurrentUser as CurrentUserType } from "../../common/auth/current-user.decorator";
import { CompaniesService } from "./companies.service";
import { CreateCompanyDto, CreateCompanyPersonDto, UpdateCompanyDto, UpdateCompanyPersonDto } from "./dtos";

@ApiTags("companies")
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller()
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get("companies")
  @ApiOperation({ summary: "List company profiles." })
  list(@Query("search") search?: string, @Query("page") page?: string, @Query("pageSize") pageSize?: string) {
    return this.companies.list({ search, page: Number(page) || 1, pageSize: Number(pageSize) || 50 });
  }

  @Get("companies/:id")
  @ApiOperation({ summary: "Get company with jobs and hiring contacts." })
  get(@Param("id") id: string) {
    return this.companies.get(id);
  }

  @Post("companies")
  @ApiOperation({ summary: "Create/upsert company. Admin/manager/recruiter." })
  create(@CurrentUser() user: CurrentUserType, @Body() dto: CreateCompanyDto) {
    return this.companies.create(user, dto);
  }

  @Patch("companies/:id")
  @ApiOperation({ summary: "Update company. Admin/manager/recruiter." })
  update(@CurrentUser() user: CurrentUserType, @Param("id") id: string, @Body() dto: UpdateCompanyDto) {
    return this.companies.update(user, id, dto);
  }

  @Post("companies/:id/people")
  @ApiOperation({ summary: "Add hiring contact to company." })
  addPerson(@CurrentUser() user: CurrentUserType, @Param("id") id: string, @Body() dto: CreateCompanyPersonDto) {
    return this.companies.addPerson(user, id, dto);
  }

  @Patch("company-people/:id")
  @ApiOperation({ summary: "Update hiring contact." })
  updatePerson(@CurrentUser() user: CurrentUserType, @Param("id") id: string, @Body() dto: UpdateCompanyPersonDto) {
    return this.companies.updatePerson(user, id, dto);
  }
}
