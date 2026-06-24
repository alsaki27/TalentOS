import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  ApplicationCommentEntity,
  ApplicationEntity,
  ApplicationEventEntity,
  AuditLogEntity,
  ProfileEntity,
} from "../../entities";
import { ApplicationsController } from "./applications.controller";
import { ApplicationsService } from "./applications.service";

@Module({
  imports: [TypeOrmModule.forFeature([ApplicationEntity, ApplicationEventEntity, ApplicationCommentEntity, AuditLogEntity, ProfileEntity])],
  controllers: [ApplicationsController],
  providers: [ApplicationsService],
})
export class ApplicationsModule {}
