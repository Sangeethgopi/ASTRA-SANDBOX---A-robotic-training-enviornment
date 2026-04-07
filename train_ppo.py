from stable_baselines3 import PPO
from rl_environment import TazerBipedEnv

def train():
    env = TazerBipedEnv(render=False)
    
    model = PPO("MlpPolicy", env, verbose=1, 
                learning_rate=3e-4, 
                n_steps=2048, 
                batch_size=64, 
                n_epochs=10, 
                gamma=0.99)
    
    print("Starting AI Training Loop...")
    model.learn(total_timesteps=100000)
    
    model.save("tazer_walk_model")
    print("Training complete. Model saved.")

if __name__ == "__main__":
    train()
