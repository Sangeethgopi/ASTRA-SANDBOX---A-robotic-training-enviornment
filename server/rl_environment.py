import gymnasium
import numpy as np
import pybullet as p
import pybullet_data
import time
import warnings

# Suppress deprecation and NumPy 2.0 migration noise
warnings.filterwarnings('ignore')

class TazerBipedEnv(gymnasium.Env):
    """
    A reinforcement learning environment for a bipedal robot 
    mirroring the Astra Robotic Sandbox 'TazerBot'.
    """
    def __init__(self, render=False):
        super(TazerBipedEnv, self).__init__()
        
        self.render_mode = render
        if self.render_mode:
            p.connect(p.GUI)
        else:
            p.connect(p.DIRECT)
            
        p.setAdditionalSearchPath(pybullet_data.getDataPath())
        
        # Action Space: Torques for Hips, Knees, Ankles (Left/Right)
        # 6 Joints: [HipL, KneeL, AnkL, HipR, KneeR, AnkR]
        self.action_space = gym.spaces.Box(low=-1.0, high=1.0, shape=(6,), dtype=np.float32)
        
        # Observation Space: [Pos, Ori, Vel, AngVel, JointAngles, JointVels]
        # Very simplified for this draft
        self.observation_space = gym.spaces.Box(low=-np.inf, high=np.inf, shape=(20,), dtype=np.float32)
        
        self.reset()
        
    def reset(self, seed=None, options=None):
        p.resetSimulation()
        p.setGravity(0, 0, -9.81)
        self.plane = p.loadURDF("plane.urdf")
        
        # In a real scenario, we'd load a custom URDF mirroring our TazerBot specs.
        # For this prototype, we'll use the generic humanoid and map our 6 core joints.
        self.robot = p.loadURDF("humanoid/humanoid.urdf", [0, 0, 1.2])
        
        self.step_counter = 0
        return self._get_obs(), {}
    
    def _get_obs(self):
        pos, ori = p.getBasePositionAndOrientation(self.robot)
        vel, ang_vel = p.getBaseVelocity(self.robot)
        
        # Simplified observation vector
        obs = np.concatenate([pos, ori, vel, ang_vel, np.zeros(6)]).astype(np.float32)
        return obs
    
    def step(self, action):
        # Scale actions to torque values
        torques = action * 50.0 
        
        # Apply torques to relevant joints (mapping depends on URDF)
        # p.setJointMotorControlArray(self.robot, joint_indices, p.TORQUE_CONTROL, forces=torques)
        
        p.stepSimulation()
        self.step_counter += 1
        
        # Reward Function (Senior Robotics Engineer design)
        pos, _ = p.getBasePositionAndOrientation(self.robot)
        vel, _ = p.getBaseVelocity(self.robot)
        
        # Forward velocity + Upright posture - Stability error
        reward = vel[0] * 1.0 - 0.1 * abs(pos[1]) + 0.1 * pos[2]
        
        terminated = pos[2] < 0.6  # Terminate if robot falls
        truncated = self.step_counter > 1000
        
        return self._get_obs(), reward, terminated, truncated, {}
    
    def close(self):
        p.disconnect()
