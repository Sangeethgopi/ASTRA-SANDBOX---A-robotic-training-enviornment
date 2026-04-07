# Astra Sandbox: Professional Robotic Simulation

A high-fidelity humanoid robotic simulation built with **Three.js** and **Rapier3D**.

## Features
- **Articulated Humanoid Physics**: Each limb is a separate rigid body with mass and physical joint motors.
- **Active Balancing (PD Control)**: Custom Proportional-Derivative controllers maintain the robot's upright posture in real-time.
- **Biomimetic Procedural Gait**: Neural-inspired locomotion using Inverse Kinematics (IK) and motorized servos.
- **AI Brain**: Integrated Gemini API support for natural language command parsing (`"walk forward fast"`, `"jump over the red box"`).
- **Multi-Environment Simulation**: Support for Earth gravity, Water buoyancy, and Space zero-gravity.

## How to Run Locally
1. Simply open `index.html` in a modern web browser.
2. For the best experience, use a local server like `npx serve` or Live Server.

## Deployment Instructions

### Vercel Cloud Deployment (Recommended)
1. Push this folder to a GitHub repository.
2. Log in to your **Vercel** dashboard.
3. Import the repository. Vercel will automatically detect the `vercel.json` configuration.
4. Your **3D Simulation** will be live at the root domain, and your **Python API** will be accessible at `/api/`.

### GitHub Pages (Static Only)
1. Push this folder to a GitHub repository.
2. Go to **Settings > Pages**.
3. Under **Build and deployment**, set Source to **GitHub Actions**.
4. Your site will be live at `https://yourusername.github.io/your-repo/`.

## Controls
- **Left Click + Drag**: Orbit Camera
- **Right Click + Drag**: Pan Camera
- **Scroll**: Zoom
- **Click Robot**: Select & Open Component Inspector
- **Gizmo (Arrows)**: Move objects manually
- **AI Input**: Type commands to the robot brain (Use `/key YOUR_API_KEY` to enable Gemini support)
