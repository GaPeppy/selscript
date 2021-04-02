const {Builder, By, Key, until} = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const fs = require('fs')
const csv = require('csv-parser')
const axios = require('axios')

//Global Vars
var Gdriver, GuserLogFileHandle
const Guserlogfilename = '/users/cfield/dev/pshipcof/userlog.txt'
const GpartnerQueryKey = process.env.NEW_RELIC_PARTNER_API_KEY
const GpartnerId = process.env.NEW_RELIC_PARTNER_ID
const GloginURL = 'https://login.newrelic.com'
const GfilterMasterAccountId = process.env.NEW_RELIC_FILTER_MASTER_ACCOUNT_ID
const GfilterSubAccountId    = process.env.NEW_RELIC_FILTER_SUB_ACCOUNT_ID
const GtestRunUserLimit = 0
const GtestRunAcctLimit = 0

//
//
//
async function ScrapeBrowserUp() {
  Gdriver = await new Builder().forBrowser('chrome').build()
  await Gdriver.manage().setTimeouts( { implicit: 10000, pageLoad: 30000, script: 15000 } )
  console.log('ScrapeBrowserUp -> Gdriver is good')
  //await driver.get(firsturl)
  //await driver.manage().addCookie({name: logincookiename,value:logincookievalue, domain:'*.newrelic.com'})
}

//
//
//
async function ScrapeLoginManualCredentials(loginURL) {

  try {

    console.log('ScrapeLoginManualCredentials(): loading loginURL:',loginURL)
    await Gdriver.get(loginURL)
    await Gdriver.wait(until.titleIs('New Relic One'), 60000);
    console.log('ScrapeLoginManualCredentials()-> successfully found [New Relic One]')

  } catch (error) {
    console.log('ScrapeLoginManualCredentials() failed:', error)
    screenshot = await Gdriver.takeScreenshot()
    fs.writeFileSync('ScrapeSSOLogin.png',screenshot,'base64')
    throw error
  }
}


async function ScrapeLoop(nAccountId) {

  await Gdriver.manage().setTimeouts( { implicit: 2000 } )

  try {
    api_url = 'https://account.newrelic.com/accounts/' + nAccountId.toString() + '/users'

    console.log(`${(new Date()).toISOString()}:ScrapeLoop()-> start:`)
    await Gdriver.get(api_url);

    Gdriver.sleep(2000)

     werows = []
     try {
      werows = await Gdriver.findElements(By.xpath('//div[contains(text(),"Pending invite")]'))
      console.log('werows length:',werows.length)
    } catch (error) {
      console.log('ScrapeLoop()-> caught error - ignoring:',error)
    }
    if(werows.length > 0){
      console.log('ScrapeLogin()-> found pending',werows.length,nAccountId.toString())
    }

  } catch(error) {
    console.log('ScrapeLoop()-> caught error',error)
    Gdriver.takeScreenshot().then(function(data){
          fs.writeFileSync('ScrapeLoop.png',data,'base64')
    })
  } //catch
}


async function ScrapeBrowserDown(){
  await Gdriver.quit()
}


async function GetAccountList(sPartnerId, sPartnerKey){

  alist = []
  i=1
  for (; i < 11;i++){
    plist = await GetAccountListPage(sPartnerId, sPartnerKey, i)
    alist = [...new Set([...alist,...plist])]
    if(plist.length < 1000){
      break
    }
  }
  console.log('GetAccountList()-> page,count',i,alist.length)
  return alist
}


async function GetAccountListPage(sPartnerId, sPartnerKey, nPage=1) {
  sURI = 'https://rpm.newrelic.com/api/v2/partners/' + sPartnerId + '/accounts?page=' + nPage.toString()

  var appsListOpts = {
  	headers: {'Accept': 'application/json', 'X-Api-Key': sPartnerKey}
  }

  console.log(`GetAccountListPage(pg=${nPage})-> axios.get():`,sURI)
  try {
    const response = await axios.get(sURI,appsListOpts)
    if(response.status != 200){
      console.log('GetAccountListPage()-> failed:', response.status, response.data)
      return []
    }

    //debug data dump
    //console.log('response.data:',response.data)
    accountlist = response.data.accounts.slice()
    console.log(`GetAccountListPage(pg=${nPage})-> primary response count:`,accountlist.length)
    return accountlist

  } catch (error) {
    console.log(`GetAccountListPage(pg=${nPage})-> dang it:`,error)
    return []
  }
}


function FilterAccountList(accountlist){
  nlist = accountlist.filter((x) => {
    if (x.status == 'cancelled') {return false}
    if (GfilterSubAccountId == '' && GfilterMasterAccountId == '') {return true}
    if (GfilterSubAccountId > ''){
      if(x.id == GfilterSubAccountId) {return true} else {return false}
    }
    if (GfilterMasterAccountId > ''){
      if(x.parent_account_id == GfilterMasterAccountId) {return true} else {return false}
    }
    return false
  })
  //let's consistently work the accounts in numeric order
  nlist.sort((a, b) => (a.id > b.id) ? 1 : -1)
  console.log('testmain()->filtered Account List count:',GfilterMasterAccountId,GfilterSubAccountId,nlist.length)
  return nlist
}

async function main(){
  console.log(`main()-> start the party`)


  //get account list and filter to target subset
  accountlist = await GetAccountList(GpartnerId,GpartnerQueryKey)
  console.log(`${(new Date()).toISOString()}:main()->accountlist:`,accountlist.length)
  filterlist = FilterAccountList(accountlist)
  if(GtestRunAcctLimit > 0 && filterlist.length > GtestRunAcctLimit) {console.log(`main()-> acct limt`,GtestRunAcctLimit);filterlist = filterlist.slice(0,GtestRunAcctLimit)}

  //forcing Colin test accounts
  //filterlist = [{id:1977586,name:'surfing',parent_account_id:null}]

  //start the screen scraping
  await ScrapeBrowserUp()
  try {
    await ScrapeLoginManualCredentials(GloginURL)

    for (oAcct of filterlist) {
      console.log(`${(new Date()).toISOString()}:main()-> looping for:`,oAcct.id, oAcct.name)
      await ScrapeLoop(oAcct.id)
    }
  } finally {
    await ScrapeBrowserDown()
  }

  console.log(`${(new Date()).toISOString()}:main()-> so long and thanks for all the fish`)
}


//start the party
main()
