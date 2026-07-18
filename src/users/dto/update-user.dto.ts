export class UpdateUserDto {
  name?: string;
  displayName?: string;
  email?: string;
  phone?: string;
  jobTitle?: string;
  industryId?: string;
  subIndustryId?: string;
  timezone?: string;
  language?: string;
  brandName?: string;
  brandLogo?: string;
  website?: string;
  emailNotification?: boolean;
  pushNotification?: boolean;
  weeklyNotification?: boolean;
  role?: 'USER' | 'SUPERADMIN' | 'CONTENTADMIN' | 'TECHNICIANADMIN' | 'FINANCEADMIN';
  isActive?: boolean;
}