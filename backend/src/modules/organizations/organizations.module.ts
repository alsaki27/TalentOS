import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { OrganizationEntity } from "../../entities";
import { AuthorizationService } from "../../common/auth/authorization.service";
import { OrganizationsController } from "./organizations.controller";
import { OrganizationsService } from "./organizations.service";

@Module({
  imports: [TypeOrmModule.forFeature([OrganizationEntity])],
  controllers: [OrganizationsController],
  providers: [OrganizationsService, AuthorizationService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
