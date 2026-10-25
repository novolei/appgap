import type { Actor } from "../worker/env";
export type { Actor };
export type Donation = {id:string;amountMinor:number;currency:string;status:"pending"|"confirmed"|"rejected"|"refunded";public:number;name:string;message:string;createdAt:string;confirmedAt:string|null};
export type DonationFeed = {currency:string;paymentUrl:string|null;qrUrl:string|null;totals:{amountMinor:number;supporters:number};rankings:{id:string;name:string;amountMinor:number;times:number}[];recent:{id:string;name:string;amountMinor:number;message:string;confirmedAt:string}[];updatedAt:string};
export type Dashboard = {user:Actor;pools:{pool:string;n:number}[];sessions:number;personalRemaining:number;budget:{remaining:number;limit:number};history:{id:string;title:string;createdAt:string;expiresAt:string;visibility:string}[]};
export type AdminUser = Actor & {lastLoginAt:string|null;watchCount:number;buildCount:number;researchCount:number;activeSessions:number;donatedMinor:number};
export type AdminUsers = {items:AdminUser[];total:number;page:number;pageSize:number;summary:{registered:number;newThisWeek:number;loggedInThisWeek:number;admins:number}};
