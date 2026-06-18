import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { PlanEntity, SubscriptionEntity } from "../../entities";
import { CreatePlanDto, UpdatePlanDto, CreateSubscriptionDto, UpdateSubscriptionDto } from "./dtos";

@Injectable()
export class BillingService {
  constructor(
    @InjectRepository(PlanEntity)
    private readonly plans: Repository<PlanEntity>,
    @InjectRepository(SubscriptionEntity)
    private readonly subscriptions: Repository<SubscriptionEntity>,
  ) {}

  listPlans() {
    return this.plans.find({ where: { isActive: true }, order: { priceMonthly: "ASC" } });
  }

  async getPlan(id: string) {
    const plan = await this.plans.findOne({ where: { id } });
    if (!plan) throw new NotFoundException("Plan not found.");
    return plan;
  }

  createPlan(dto: CreatePlanDto) {
    return this.plans.save(this.plans.create(dto));
  }

  async updatePlan(id: string, dto: UpdatePlanDto) {
    const plan = await this.getPlan(id);
    Object.assign(plan, dto);
    return this.plans.save(plan);
  }

  async getSubscription(id: string) {
    const sub = await this.subscriptions.findOne({
      where: { id },
      relations: { plan: true, organization: true },
    });
    if (!sub) throw new NotFoundException("Subscription not found.");
    return sub;
  }

  async getSubscriptionByOrganization(organizationId: string) {
    const sub = await this.subscriptions.findOne({
      where: { organizationId },
      relations: { plan: true },
      order: { createdAt: "DESC" },
    });
    if (!sub) throw new NotFoundException("Subscription not found.");
    return sub;
  }

  createSubscription(dto: CreateSubscriptionDto) {
    return this.subscriptions.save(this.subscriptions.create(dto));
  }

  async updateSubscription(id: string, dto: UpdateSubscriptionDto) {
    const sub = await this.getSubscription(id);
    Object.assign(sub, dto);
    return this.subscriptions.save(sub);
  }

  async cancelSubscription(id: string) {
    const sub = await this.getSubscription(id);
    sub.status = "canceled";
    return this.subscriptions.save(sub);
  }

  async checkPlanLimits(organizationId: string) {
    const sub = await this.subscriptions.findOne({
      where: { organizationId },
      relations: { plan: true },
      order: { createdAt: "DESC" },
    });
    if (!sub) return { hasPlan: false, limits: null, usage: null };
    const plan = sub.plan;
    return {
      hasPlan: true,
      limits: {
        maxUsers: plan?.maxUsers ?? null,
        maxJobs: plan?.maxJobs ?? null,
        maxApplications: plan?.maxApplications ?? null,
      },
      usage: {
        users: 0,
        jobs: 0,
        applications: 0,
      },
    };
  }
}
