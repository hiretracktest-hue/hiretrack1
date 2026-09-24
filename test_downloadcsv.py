from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
import time

# 1. Launch Chrome and set up the smart wait
driver = webdriver.Chrome()
driver.maximize_window()
wait = WebDriverWait(driver, 15)

try:
    # 2. Login as Hiring Manager
    driver.get("https://hiretrack1-xi.vercel.app/signin")
    
    # Wait for the email field to appear, then fill in credentials
    wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, "input[type='email']")))
    driver.find_element(By.CSS_SELECTOR, "input[type='email']").send_keys("thusitha@hiretrack.lk")
    driver.find_element(By.CSS_SELECTOR, "input[type='password']").send_keys("thusitha12345")
    
    # Click Sign in
    driver.find_element(By.XPATH, "//button[contains(text(), 'Sign in')]").click()

    # Wait for successful login (dashboard loads)
    wait.until(EC.url_contains("/dashboard"))

    # 3. Navigate directly to the Reports page
    driver.get("https://hiretrack1-xi.vercel.app/reports")

    # 4. SMART WAIT: Wait for the Download button to render on the page
    print("Waiting for the Download button to render...")
    
    # Looking for either a <button> or <a> tag containing the exact text
    download_btn_xpath = "//*[contains(., 'Download candidates CSV')]"
    download_button = wait.until(EC.element_to_be_clickable((By.XPATH, download_btn_xpath)))
    
    time.sleep(1) # Brief pause to ensure background scripts are loaded

    # 5. Scroll down to make sure the button is fully visible in the browser window
    driver.execute_script("arguments[0].scrollIntoView({behavior: 'smooth', block: 'center'});", download_button)
    time.sleep(2) # Wait for the smooth scrolling animation to finish

    # 6. Click the button to trigger the CSV download
    download_button.click()
    print("✅ Clicked 'Download candidates CSV'.")

    # 7. Wait to allow the file to download
    # Selenium does not natively track file downloads, so a hard sleep is standard here 
    # to give the browser time to save the file to your local Downloads folder.
    print("Waiting 5 seconds for the download to complete...")
    time.sleep(5)
    
    print("✅ Test Passed: CSV export triggered successfully.")

except Exception as e:
    # Print the exact error if the test crashes
    print(f"❌ TEST CRASHED: An error occurred during the test:")
    print(e)

finally:
    # 8. Close browser
    driver.quit()