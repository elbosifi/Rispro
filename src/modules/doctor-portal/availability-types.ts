export type AvailabilityStatus =
  | "available"
  | "unavailable"
  | "preferred"
  | "not_preferred"
  | "leave"
  | "conference"
  | "admin"
  | "teaching"
  | "on_call";

export type LeaveType =
  | "annual_leave"
  | "sick_leave"
  | "conference"
  | "study_leave"
  | "admin_leave"
  | "emergency_absence";

export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface DoctorAvailabilityRow {
  id: number;
  doctorId: number;
  doctorName: string | null;
  date: string;
  startTime: string | null;
  endTime: string | null;
  availabilityStatus: AvailabilityStatus;
  note: string | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface DoctorLeaveRequestRow {
  id: number;
  doctorId: number;
  doctorName: string | null;
  startDate: string;
  endDate: string;
  leaveType: LeaveType;
  status: LeaveStatus;
  reason: string | null;
  approvedBy: number | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

