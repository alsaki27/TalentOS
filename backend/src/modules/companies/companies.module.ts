import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthorizationService } from "../../common/auth/authorization.service";
import { ApplicationEntity, CompanyEntity, CompanyPersonEntity, JobEntity, ProfileEntity } from "../../entities";
import { CompaniesController } from "./companies.controller";
import { CompaniesService } from "./companies.service";

@Module({
  imports: [TypeOrmModule.forFeature([CompanyEntity, CompanyPersonEntity, JobEntity, ApplicationEntity, ProfileEntity])],
  controllers: [CompaniesController],
  providers: [CompaniesService, AuthorizationService],
})
export class CompaniesModule {}
