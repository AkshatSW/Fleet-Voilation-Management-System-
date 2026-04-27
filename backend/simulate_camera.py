"""
Fleet Violation Monitoring — Live Camera Simulator

Simulates AI dashcams sending violation events to the backend webhook.
Sends a new violation every few seconds with realistic data.

Usage:
    python simulate_camera.py                  # Default: 1 violation every 5 seconds
    python simulate_camera.py --interval 3     # Every 3 seconds
    python simulate_camera.py --burst 5        # Burst of 5 then wait
    python simulate_camera.py --url http://your-server.com/api/webhook/violation
"""


import argparse
import json
import random
import time
import os
from datetime import datetime

import requests

# Configuration
DEFAULT_URL = os.getenv("SIMULATE_CAMERA_URL", "http://localhost:8000/api/webhook/violation")
API_KEY = os.getenv("WEBHOOK_API_KEY", "dashcam-webhook-secret-key")

# Violation types with their probability weights and typical speeds
VIOLATION_PROFILES = {
    "overspeed": {
        "weight": 30,
        "severity_dist": ["low", "medium", "medium", "high"],
        "speed_range": (120, 170),
        "description": "Vehicle exceeding speed limit",
    },
    "harsh_braking": {
        "weight": 25,
        "severity_dist": ["low", "low", "medium", "medium"],
        "speed_range": (60, 110),
        "description": "Sudden hard braking detected",
    },
    "phone_usage": {
        "weight": 20,
        "severity_dist": ["medium", "medium", "high", "high"],
        "speed_range": (30, 90),
        "description": "Driver using mobile phone",
    },
    "no_seatbelt": {
        "weight": 12,
        "severity_dist": ["low", "medium", "medium", "high"],
        "speed_range": (20, 80),
        "description": "Seatbelt not detected on driver",
    },
    "drowsiness": {
        "weight": 8,
        "severity_dist": ["high", "high", "critical", "critical"],
        "speed_range": (50, 100),
        "description": "Driver drowsiness/fatigue detected",
    },
    "yawning": {
        "weight": 5,
        "severity_dist": ["low", "medium", "medium", "high"],
        "speed_range": (40, 90),
        "description": "Excessive yawning detected",
    },
}

# Simulated drivers and vehicles (matches seed data)
DRIVER_VEHICLE_PAIRS = [
    (1, 1, "Ahmed Al-Mansouri", "DXB-A-10000"),
    (2, 2, "Mohammed Rashid", "DXB-B-11111"),
    (3, 3, "Khalid Ibrahim", "DXB-C-12222"),
    (4, 4, "Omar Hassan", "DXB-D-13333"),
    (5, 5, "Youssef Al-Ali", "DXB-E-14444"),
    (6, 6, "Fahad Al-Dosari", "DXB-F-15555"),
    (7, 7, "Sultan Al-Qahtani", "DXB-G-16666"),
    (8, 8, "Nasser Al-Harbi", "DXB-H-17777"),
    (9, 9, "Tariq Al-Shammari", "DXB-I-18888"),
    (10, 10, "Hamad Al-Otaibi", "DXB-J-19999"),
    (11, 11, "Rajesh Kumar", "RUH-A-20000"),
    (12, 12, "Sunil Patel", "RUH-B-22222"),
    (13, 13, "Vikram Singh", "RUH-C-24444"),
    (14, 14, "Arjun Sharma", "RUH-D-26666"),
    (15, 15, "Deepak Verma", "RUH-E-28888"),
]

# GPS routes (simulated movement along roads)
ROUTES = {
    "dubai_szr": [  # Sheikh Zayed Road
        (25.2048, 55.2708), (25.1980, 55.2650), (25.1900, 55.2580),
        (25.1820, 55.2520), (25.1750, 55.2450), (25.1680, 55.2380),
    ],
    "dubai_emirates": [  # Emirates Road
        (25.2100, 55.3300), (25.2200, 55.3500), (25.2300, 55.3700),
        (25.2400, 55.3900), (25.2500, 55.4100),
    ],
    "riyadh_main": [  # King Fahd Road, Riyadh
        (24.7136, 46.6753), (24.7200, 46.6800), (24.7300, 46.6900),
        (24.7400, 46.7000), (24.7500, 46.7100),
    ],
    "jeddah_port": [  # Jeddah Corniche
        (21.4858, 39.1925), (21.4900, 39.1880), (21.4950, 39.1840),
        (21.5000, 39.1800), (21.5050, 39.1760),
    ],
}

# Track position for each driver (simulates movement)
driver_positions = {}


def get_next_position(driver_id):
    """Simulate GPS movement along a route."""
    if driver_id not in driver_positions:
        route_name = random.choice(list(ROUTES.keys()))
        driver_positions[driver_id] = {
            "route": route_name,
            "index": 0,
        }

    pos = driver_positions[driver_id]
    route = ROUTES[pos["route"]]
    base_lat, base_lon = route[pos["index"] % len(route)]

    # Add small random offset (simulates being on nearby roads)
    lat = base_lat + random.uniform(-0.005, 0.005)
    lon = base_lon + random.uniform(-0.005, 0.005)

    # Move to next position
    pos["index"] += 1

    # Occasionally switch routes
    if random.random() < 0.1:
        pos["route"] = random.choice(list(ROUTES.keys()))
        pos["index"] = 0

    return round(lat, 7), round(lon, 7)


def generate_violation():
    """Generate a single realistic violation event."""
    # Pick violation type (weighted)
    types = list(VIOLATION_PROFILES.keys())
    weights = [VIOLATION_PROFILES[t]["weight"] for t in types]
    event_type = random.choices(types, weights=weights, k=1)[0]
    profile = VIOLATION_PROFILES[event_type]

    # Pick driver/vehicle
    driver_id, vehicle_id, driver_name, plate = random.choice(DRIVER_VEHICLE_PAIRS)

    # Get position
    lat, lon = get_next_position(driver_id)

    # Severity
    severity = random.choice(profile["severity_dist"])

    # Speed
    speed = random.randint(*profile["speed_range"])

    return {
        "driver_id": driver_id,
        "vehicle_id": vehicle_id,
        "event_type": event_type,
        "severity": severity,
        "timestamp": datetime.now().isoformat(),
        "latitude": lat,
        "longitude": lon,
        "speed": speed,
        "video_url": f"https://dashcam-storage.example.com/live-clip-{random.randint(10000, 99999)}.mp4",
    }, driver_name, plate, profile["description"]


def send_violation(url, violation_data):
    """Send violation to webhook endpoint."""
    headers = {
        "X-API-Key": API_KEY,
        "Content-Type": "application/json",
    }
    response = requests.post(url, json=violation_data, headers=headers, timeout=5)
    return response


def print_violation(violation, driver_name, plate, description, response):
    """Pretty print the violation event."""
    status = f"\033[92m{response.status_code}\033[0m" if response.status_code == 201 else f"\033[91m{response.status_code}\033[0m"

    severity_colors = {
        "low": "\033[92m",       # green
        "medium": "\033[93m",    # yellow
        "high": "\033[91m",      # red
        "critical": "\033[95m",  # magenta
    }
    sev_color = severity_colors.get(violation["severity"], "")

    print(f"\033[90m[{violation['timestamp'][:19]}]\033[0m "
          f"[{status}] "
          f"\033[1m{violation['event_type'].upper()}\033[0m "
          f"{sev_color}({violation['severity']})\033[0m "
          f"| {driver_name} ({plate}) "
          f"| {violation['speed']} km/h "
          f"| ({violation['latitude']}, {violation['longitude']})")


def main():
    parser = argparse.ArgumentParser(description="Simulate AI dashcam violations")
    parser.add_argument("--url", default=DEFAULT_URL, help="Webhook URL")
    parser.add_argument("--interval", type=float, default=5.0, help="Seconds between violations")
    parser.add_argument("--burst", type=int, default=1, help="Number of violations per interval")
    parser.add_argument("--count", type=int, default=0, help="Stop after N violations (0=infinite)")
    args = parser.parse_args()

    print("=" * 70)
    print("  FLEET VIOLATION MONITORING — CAMERA SIMULATOR")
    print("=" * 70)
    print(f"  Webhook URL:  {args.url}")
    print(f"  Interval:     {args.interval}s")
    print(f"  Burst size:   {args.burst}")
    print(f"  Max count:    {'infinite' if args.count == 0 else args.count}")
    print("=" * 70)
    print("  Press Ctrl+C to stop\n")

    total_sent = 0

    try:
        while True:
            for _ in range(args.burst):
                violation, driver_name, plate, description = generate_violation()
                try:
                    response = send_violation(args.url, violation)
                    print_violation(violation, driver_name, plate, description, response)
                    total_sent += 1
                except requests.exceptions.ConnectionError:
                    print(f"\033[91m  ERROR: Cannot connect to {args.url} — is the backend running?\033[0m")
                except requests.exceptions.Timeout:
                    print(f"\033[91m  ERROR: Request timed out\033[0m")

                if args.count > 0 and total_sent >= args.count:
                    print(f"\n  Sent {total_sent} violations. Done.")
                    return

            time.sleep(args.interval)

    except KeyboardInterrupt:
        print(f"\n\n  Stopped. Total violations sent: {total_sent}")


if __name__ == "__main__":
    main()
