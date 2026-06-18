import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PlanEntity, SubscriptionEntity } from "../../entities";
import { AuthorizationService } from "../../common/auth/authorization.service";
import { BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";

@Module({
  imports: [TypeOrmModule.forFeature([PlanEntity, SubscriptionEntity])],
  controllers: [BillingController],
  providers: [BillingService, AuthorizationService],
  exports: [BillingService],
})
export class BillingModule {}
