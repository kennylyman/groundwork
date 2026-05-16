import anthropic
import json
import os
import glob
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

LOG_DIR = Path("../logs")
REPORTS_DIR = Path("../reports")


ANALYSIS_PROMPT = """You are an expert business process analyst and automation consultant reviewing workflow monitoring data from a home care company admin team.

You have been given a session log from Groundwork, an AI-powered workflow monitoring system. The log contains timestamped classifications of exactly what an admin employee was doing throughout their day.

Your job is to analyze this data and produce a clear, actionable automation opportunity report that a business owner can use to make decisions about staffing and automation investments.

Here is the session log data:

{log_data}

Produce a detailed report in this exact structure:

## GROUNDWORK ANALYSIS REPORT
**Business:** {business_id}
**Employee:** {employee_id}
**Session:** {session_id}
**Period:** {started_at} to {ended_at}
**Total Captures:** {total_captures}

---

## EXECUTIVE SUMMARY
3-4 sentences summarizing what this employee spent their time on and the biggest automation opportunity identified.

---

## TIME DISTRIBUTION
Break down estimated time spent by category based on the captures. Show as percentage and estimated minutes. Note: each capture represents approximately 90 seconds of work.

---

## TASK INVENTORY
List every distinct task observed with:
- Task description
- Category
- Frequency observed
- Automation potential (High/Medium/Low/None)
- Estimated time cost per occurrence

---

## TOP AUTOMATION OPPORTUNITIES
Rank the top 3-5 automation opportunities by:
1. Opportunity name
2. Current time cost (estimated monthly)
3. Automation feasibility (1-10)
4. Recommended automation approach
5. Estimated time savings %
6. Priority score

---

## WORKFLOW PATTERNS IDENTIFIED
Describe any workflow sequences or patterns observed across multiple captures. What triggers what? What follows what?

---

## ROLE ASSESSMENT
Based on this data:
- What percentage of this role is automatable?
- What requires human judgment?
- What is the recommendation for this position long term?

---

## IMMEDIATE ACTION ITEMS
List 3-5 specific things the business owner should do in the next 30 days based on this data.

---

## DATA QUALITY NOTES
Note any gaps, anomalies, or areas where more monitoring time would improve the analysis accuracy.

Be specific. Use the actual task descriptions, software names, and workflow details from the log. Do not be generic. This report should read like it was written by someone who watched this employee work all day."""


def load_session_logs(business_id=None, employee_id=None):
    """Load all session logs, optionally filtered by business or employee."""
    all_sessions = []
    
    log_files = sorted(LOG_DIR.glob("session_*.json"))
    
    if not log_files:
        print("No session logs found.")
        return []
    
    for log_file in log_files:
        try:
            with open(log_file, "r") as f:
                session = json.load(f)
            
            if business_id and session.get("business_id") != business_id:
                continue
            if employee_id and session.get("employee_id") != employee_id:
                continue
            
            all_sessions.append(session)
        except Exception as e:
            print(f"Error loading {log_file}: {e}")
    
    return all_sessions


def merge_sessions(sessions):
    """Merge multiple sessions into one combined dataset for analysis."""
    if not sessions:
        return None
    
    if len(sessions) == 1:
        return sessions[0]
    
    merged = {
        "session_id": f"merged_{len(sessions)}_sessions",
        "employee_id": sessions[0]["employee_id"],
        "business_id": sessions[0]["business_id"],
        "started_at": sessions[0]["started_at"],
        "ended_at": sessions[-1].get("ended_at", "ongoing"),
        "total_captures": sum(s.get("total_captures", 0) for s in sessions),
        "captures": []
    }
    
    for session in sessions:
        merged["captures"].extend(session.get("captures", []))
    
    return merged


def generate_report(session_data):
    """Send session data to Claude for analysis and return the report."""
    
    # Prepare a clean version of the log for the prompt
    log_summary = {
        "session_id": session_data["session_id"],
        "employee_id": session_data["employee_id"],
        "business_id": session_data["business_id"],
        "started_at": session_data["started_at"],
        "ended_at": session_data.get("ended_at", "ongoing"),
        "total_captures": session_data["total_captures"],
        "captures": session_data["captures"]
    }
    
    prompt = ANALYSIS_PROMPT.format(
        log_data=json.dumps(log_summary, indent=2),
        business_id=session_data["business_id"],
        employee_id=session_data["employee_id"],
        session_id=session_data["session_id"],
        started_at=session_data["started_at"],
        ended_at=session_data.get("ended_at", "ongoing"),
        total_captures=session_data["total_captures"]
    )
    
    print("Sending to Claude for analysis...")
    
    response = client.messages.create(
        model="claude-opus-4-5",
        max_tokens=4000,
        messages=[
            {
                "role": "user",
                "content": prompt
            }
        ]
    )
    
    return response.content[0].text


def save_report(report_text, session_data):
    """Save the report to the reports directory."""
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    
    timestamp = datetime.now().strftime("%Y-%m-%dT%H-%M-%S")
    employee = session_data["employee_id"]
    business = session_data["business_id"]
    
    report_file = REPORTS_DIR / f"report_{business}_{employee}_{timestamp}.md"
    
    with open(report_file, "w") as f:
        f.write(report_text)
    
    return report_file


def main():
    print("Groundwork — Analysis Engine")
    print("=" * 60)
    
    business_id = os.getenv("BUSINESS_ID", "comfort_keepers")
    employee_id = os.getenv("EMPLOYEE_ID", None)
    
    print(f"Loading logs for: {business_id}")
    if employee_id:
        print(f"Filtering by employee: {employee_id}")
    
    sessions = load_session_logs(business_id=business_id, employee_id=employee_id)
    
    if not sessions:
        print("No logs found. Run main.py first to collect data.")
        return
    
    print(f"Found {len(sessions)} session(s) with {sum(s.get('total_captures', 0) for s in sessions)} total captures")
    
    # Merge all sessions
    session_data = merge_sessions(sessions)
    
    print(f"\nAnalyzing {session_data['total_captures']} captures...")
    print("This takes 15-30 seconds...\n")
    
    # Generate report
    report = generate_report(session_data)
    
    # Save report
    report_file = save_report(report, session_data)
    
    print("\n" + "=" * 60)
    print("AUTOMATION OPPORTUNITY REPORT")
    print("=" * 60)
    print(report)
    print("=" * 60)
    print(f"\nReport saved to: {report_file}")


if __name__ == "__main__":
    main()
