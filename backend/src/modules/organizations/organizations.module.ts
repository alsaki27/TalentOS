import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { OrganizationEntity, ProfileEntity } from "../../entities";
import { AuthorizationService } from "../../common/auth/authorization.service";
import { OrganizationsController } from "./organizations.controller";
import { OrganizationsService } from "./organizations.service";

@Module({
  imports: [TypeOrmModule.forFeature([OrganizationEntity, ProfileEntity])],
  controllers: [OrganizationsController],
  providers: [OrganizationsService, AuthorizationService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
