"use client";
import { useUser } from "@clerk/nextjs";

const DashboardPage = () => {
  const { user } = useUser();

  return (
    <div>
      <div>{user?.firstName}</div>
      <div>{user?.lastName}</div>
    </div>
  );
};

export default DashboardPage;
