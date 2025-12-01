import { startOfWeek, nextSunday, previousSunday, addDays } from 'date-fns';

export const getNextSunday = (date = new Date()) => {
  return startOfWeek(nextSunday(date), { weekStartsOn: 0 });
};

export const getPreviousSunday = (date = new Date()) => {
    return previousSunday(startOfWeek(date, { weekStartsOn: 0 }));
};

export const getSubmissionDeadline = () => {
    // This function calculates the deadline for the upcoming work week.
    // The deadline is always Thursday at 15:00.
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
    
    let deadline = new Date(now);
    
    // Find the next or current Thursday
    deadline.setDate(now.getDate() - now.getDay() + 4);
    deadline.setHours(15, 0, 0, 0);

    // If we are already past this week's Thursday 15:00, the deadline is next week's Thursday.
    if (now.getTime() > deadline.getTime()) {
        deadline.setDate(deadline.getDate() + 7);
    }
    
    return deadline;
};

export const isDeadlinePassed = () => {
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
    const deadlineForCurrentWeek = getSubmissionDeadline();
    
    // To check if the submission for the *upcoming* week is closed,
    // we need to see if we've passed the Thursday 15:00 of the *current* week.
    let today = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
    let deadline = new Date(today);
    deadline.setDate(today.getDate() - today.getDay() + 4); // This week's Thursday
    deadline.setHours(15, 0, 0, 0);
    
    return today.getTime() > deadline.getTime();
};