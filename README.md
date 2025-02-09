# Armic

<img src="./Images/Armic Logo.png">

ARMIC is a Platform that fuses advanced robotics, Blockchain and AI Agents to transform patient rehabilitation.

# Fast Links:

[Demo Video](pending...)

**If you're a judge and want to go directly to any category, please click on the following references:**

- [Nethermind](#nethermind)
- [Coinbase Developer Platform](#coinbase-developer-platform)
- [Base](#base)

# Materials:

Hardware:
- [ESP32. 2x](https://www.adafruit.com/product/3405)
- [ADXL335. 1x](https://www.adafruit.com/product/163)
- [Robotic Arm x1.](https://www.amazon.com/OWI-Robotic-Soldering-Required-Extensive/dp/B0017OFRCY)
- [8 Channel DC 5V Relay Module with Optocoupler x1.](https://www.amazon.com/Elegoo-Module-Optocoupler-Arduino-Raspberry/dp/B07F623PHG)

Software:
- [Base](https://base.org/)
- [CDP Agentkit](https://python.langchain.com/docs/integrations/tools/cdp_agentkit/)
- [Remix IDE](https://remix.ethereum.org/)
- [Eclipse Mosquitto](https://github.com/eclipse-mosquitto/mosquitto)
- [Arduino IDE](https://www.arduino.cc/en/software)
- [Ollama](https://ollama.com/)
- [LangGraph](https://www.langchain.com/langgraph)
- [Edge Impulse](https://edgeimpulse.com/)
- [Alchemy](https://www.alchemy.com/)
- [NextJS](https://nextjs.org/)

## System Diagram:

<img src="./Images/system.png">

- Base: Blockchain principal, gracias a su velocidad de transaccion la comunicacion entre losdevices IoT, Plataforma Web y AI Agents no se ve comprometida.
- CDP Platform: Todas las interacciones entre los agentes y la blockchain se realiza mediante este toolkit compatible con LangGraph.
- Edge Impulse: Se utilizo este AI Framework para desarrollar la AI de deteccion de ejercicios IoT.
- Eclipse Mosquitto: Realiza la comunicacion entre todos los devices IoT, Plataforma Web y AI Agents.

# Nethermind:

Dentro de nuestro sistema de AI Agents nos basamos completamente en los diagramas del articulo de la empresa 
Anthropic [1](#references).

<img src="./Images/diagram1.png">

## LLM:

Todo nuestro servidor de LLM esta basado en dos servicios principales, los cuales son Ollama y LangGraph.

<img src="./Images/langgraph.drawio.png">

- Ollama:

    Este sevicio nos permite de forma sencilla correr cualquier modelo LLM sin la necesidad de relizar configuraciones adicionales. Ademas de poder correr los modelos mas populares de forma local.

- LangGraph:

    Este framework nos permite crear sistemas de agentes complejos, asi como manejar las llamadas a tools y sobretodo permitiendonos que los Agentes pudan controlar interacciones con la blockchain gracias a su integracion de AgentKit CDP.

## Workflow: Prompt chaining

Dentro de nuestra infraestructura de agentes realizamos varias cadenas de agentes, esto con el fin de activar herramientas y generar respuestas para los usuarios con lenguaje natual, siendo esta una etapa de pre procesado.

<img src="./Images/diagram2.png">

La seccion de codigo que mejor representa esto, es la primera llamada al AI Agent, donde primero ejecutamos una consulta al agente para obtener una estructura y posteriormente pasamos esta respuesta al segundo agente el cual nos provee el mensaje final al usuario.

    exercise = model_with_structure.invoke(setPrompt(my_payload["message"]))
    events = model.invoke(setPrompt2(exercise))
    client.publish("webpage/input", events.content)

En la UI de nuestra pagina web podras ver la respuesta que obtiene el usuario.

<img src="./Images/chat.png" width="80%">

Podemos notar que aunque el usuario recibe una repuesta human redable, el servidor LLM esta obteniendo variables e informacion del ejecicio que va a ejecutar en una siguiente etapa.

El codigo completo de este fragmento esta en el siguiente enlace:

[LLM SERVER](./LLM%20Server/Armic_Final.ipynb)

### IoT Devices:

Todos los devices fueron desarrollados con componentes y librerias open source. Asi como interconectados con la blockchain a travez de Web Sockets RPC y MQTT. 

    # EVM Events Setup
    contract = w3.eth.contract(address=contract_address, abi=contract_abi)
    # EVM Sub Topics
    transfer_event_topic = w3.keccak(text=topic_w3)
    filter_params = {
        "address": contract_address,
        "topics": [transfer_event_topic],
    }
    subscription_id = await w3.eth.subscribe("logs", filter_params)

    print(f"Subscribing to transfer events for Contract at {subscription_id}")

El codigo completo de este fragmento esta en el siguiente enlace:

[LLM SERVER](./LLM%20Server/Armic_Final.ipynb)

### AI Exercise Tracker:

AI Exercise Tracker Diagram:

<img src="./Images/Exercise Tracking.png" width="70%">

El Exercise Tracker se realizo con una board ESP32 la cual es una plataforma de hardware muy popular para realizar proyectos IoT con conectividad a internet y a su vez la board esta corriendo en Edge un modelo de AI que permite el reconocimiento de patrones complejos del acelerometro para detectar los ejecicios, para ello se utilizo la plataforma web de Edge Impulse para entrenar y deplegar el modelo.

<img src="./Images/edgeimpulse.png">

El modelo resultante de estos entrenamientos fue el siguiente.

Edge Model Accuracy:

<img src="./Images/accuracy.png">

Edge Model Confusion Matrix:

<img src="./Images/confmatrix.png">

Si bien la deteccion no es perfecta, para un modelo de AI como este es mejor evitar el under fitting y el overfitting. 

El codigo completo de este IoT device es el siguiente.

[AI EXERCISE TRACKER](./AI%20Exercise%20Tracker/Armic_EdgeImpulse_MQTT.ino)

### Arm Digital Driver:

Arm Digital Driver Diagram:

<img src="./Images/armdriver.png" width="70%">

El Arm Digital Driver se realizo de igual forma con una board ESP32 y relevadores mecanicos. Ya que nuestro brazo funciona mediante motores DC.

El codigo completo de este IoT device es el siguiente.

[ARM DRIVER](./Robotic%20Arm%20Driver/Armic_Driver_MQTT.ino)

# Coinbase Developer Platform:

Una parte crucial en el proyecto era el poder facilmente realizar interacciones con [Base](#base) de forma sencilla a travez de el AI Agent, para lograr esto utilizamos el AgentKit de CDP (Coinbase Developer Platform) compatible con LangGraph Python para lograr esto.

El codigo completo del servidor esta en el siguiente enlace:

[LLM SERVER](./LLM%20Server/Armic_Final.ipynb)

### Setup CDP Credentials:

Antes que nada es necesario configurar las credenciales de CDP en nuestro archivo [.env](./LLM%20Server/envexample) una vez configuradas las credenciales en este archivo podras utilizar el Agent Kit sin problemas, en nuestro caso es importante usar base-mainnet.

    ...
    CDP_API_KEY_NAME=XXXXX
    CDP_API_KEY_PRIVATE_KEY=XXXXX
    NETWORK_ID=base-mainnet
    ...

### CDP LangChain Setup:

En el caso del CDP Toolkit solo es necesario usar el siguiente snippet de codigo, el cual nos permite mantener de forma persistente la wallet de los agentes, con el fin de evitar perder assets o control sobre ellos. Ademas para este proyecto en particular mostramos la forma de solo importar ciertas tools del CDP Toolkit con el fin de mejorar las respuestas del agente y evitar que se confunda con ciertos prompts.

    # Setup Cdp and Wallet:

    wallet_data_file = "wallet_data.txt"
    wallet_data = None

    # Check if wallet exist

    if os.path.exists(wallet_data_file):
        with open(wallet_data_file) as f:
            wallet_data = f.read()

    # Load the wallet data

    if wallet_data is not None:
        values = {"cdp_wallet_data": wallet_data}

    agentkit = CdpAgentkitWrapper(**values)

    # persist the agent's CDP MPC Wallet Data.
    wallet_data = agentkit.export_wallet()
    with open(wallet_data_file, "w") as f:
        f.write(wallet_data)

    # Import Only Certain Tools     
    cdp_toolkit = CdpToolkit.from_cdp_agentkit_wrapper(agentkit)
    tools_cdp = cdp_toolkit.get_tools()
    import_tools = ["get_balance", "get_wallet_details", "request_faucet_funds"]
    tools = [next(tool for tool in tools_cdp if tool.name == tool_name) for tool_name in import_tools]

### PreFlight CPD Prompt:

Los modelos de AI pueden llegar a tener ciertas incosistencias al realizar llamadas a las tools en langchain, por lo cual aveces es necesario realizar modificaciones de estas antes de que pasen a la herramienta. En este caso concreto realizamos la modificacion de la tool de transfer asegurarnos que siempre el input fuera un numero entero en forma de **str**.

    # Pre flight modificators
    # https://github.com/coinbase/agentkit/tree/master/python/cdp-agentkit-core/cdp_agentkit_core/actions

    # If You want modify the preflight of any CDP function use this part
    @tool
    def transfer(amount: float, asset_id: str, destination: str, gasless: bool = False) -> str:
        """Transfer a specified amount of an asset to a destination onchain. USDC Transfers on Base Sepolia and Mainnet can be gasless. Always use the gasless option when available."""
        preFlightAmount = amount
        if(amount < 0):
            preFlightAmount = amount*10**18

        fx = next(tool for tool in tools_cdp if tool.name == "transfer")
        result = fx.run({"amount":str(preFlightAmount),"asset_id":asset_id, "destination":destination, "gassless":gasless})
        return result

    mod_tools = [transfer]

### CDP with Ollama Server:

Una parte importante del proyecto fue lograr que el toolkit funcionara con cualquier Modelo AI Open Source ya que la mayoria de ejemplos realizados en la comunidad se realizan con OpenAI API. Y como muestra de esto, nosotros utilizamos el modelo Open Source de Llama 3.1 para todo este proyecto. Ademas que al correr el modelo localmente evitamos filtraciones de los datos sencibles de los pacientes.

    model = ChatOllama(model="llama3.1:8b", keep_alive="1h")
    model_with_tools = model.bind_tools(tools + mod_tools, tool_choice="auto")

# Base:

Como blockchain principal para el proyecto se utilizo Base Mainnet, ya que esta ademas de su velocidad y bajas fees. Nos permitio desplegar nuestro propio ERC20 Token y con el poder realizar la comunicacion con los IoT Devices. Sobre todo AgentKit nos permitio de forma muy rapida y sencilla poder realizar de forma automatizada todas las transferencias a mediante nuestros AI Agents.

### ARM Token:

Nuestro ERC20 Tokens tiene la funcion de servir como utility token para los pacientes y devices IoT. Permtiendo que al realizar transferencias de este token a las wallets de los devices, estos realicen acciones y a los usuarios para recibir recompensas.

ARM Token Contract: [CODE](./Contract/ArmicToken.sol)
ARM Token Contract Address: https://basescan.org/token/0x7348b50c6301fec2fa1bc4355b3fade2442f5747

### IoT, Agents and Transactions:

Algo fundamental del proyecto fue poder controlar los devices IoT al realizar transacciones en blockchain y a su vez que los AI Agents pudieran realizar estas transacciones.

<img src="./Images/biot.png">

1. CDP se activa por medio del AI Agent.
2. Base Mainnet realiza la transaccion de los tokens desde la cuenta del AgentKit hacia la cuenta del Robotic Arm.
3. Nuestro Alchemy WebSocket detecta el evento de transferencia y manda la informacion al MQTT Server.
4. EL MQTT Server recibe la informacion del evento y la manda hacia el device IoT correspondiente a la address.
5. Finalmente el IoT device recibe la informacion de la accion que debe de realizar.

Este pipeline de eventos se ve de esta manera en la plataforma.

<img src="./Images/iot.png" width="80%">

# References:

1. https://www.anthropic.com/research/building-effective-agents