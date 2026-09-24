from selenium import webdriver
from selenium.webdriver.common.by import By
import time

# 1. Launch Chrome browser
driver = webdriver.Chrome()

# 2. Open the Altrium HireTrack login page
driver.get("https://hiretrack1-xi.vercel.app/signin")
driver.maximize_window()
time.sleep(2)

# 3. Find input fields
username_box = driver.find_element(By.CSS_SELECTOR, "input[type='email']")
password_box = driver.find_element(By.CSS_SELECTOR, "input[type='password']")

# Enter the correct test data from TC-01
username_box.send_keys("kevin@hiretrack.lk")
password_box.send_keys("kevin12345")

# 4. Click the Sign In button
driver.find_element(By.XPATH, "//button[contains(text(), 'Sign in')]").click()

# 5. Pause to allow the database to verify and the dashboard to load
time.sleep(5)

# 6. Verify successful login safely by checking the URL
current_url = driver.current_url

if "/dashboard" in current_url:
    print("✅ Test Passed: Login successful. Dashboard loaded correctly.")
else:
    print(f"❌ Test Failed: Still on {current_url}")

# 7. Close browser
driver.quit()