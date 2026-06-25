import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthorizationService } from "../../common/auth/authorization.service";
import { CompanyEntity, CompanyPersonEntity, JobEntity, ProfileEntity } from "../../entities";
import { JobsController } from "./jobs.controller";
import { JobsService } from "./jobs.service";

@Module({
  imports: [TypeOrmModule.forFeature([JobEntity, CompanyEntity, CompanyPersonEntity, ProfileEntity])],
  controllers: [JobsController],
  providers: [JobsService, AuthorizationService],
  exports: [JobsService],
})
export class JobsModule {}
